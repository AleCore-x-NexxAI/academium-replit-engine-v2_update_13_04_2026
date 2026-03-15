# Academium Engine — AI Agent Architecture

Complete technical documentation of the multi-agent AI system that powers Academium's business simulations.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture Principles](#architecture-principles)
3. [Agent Inventory](#agent-inventory)
4. [Orchestration Flow](#orchestration-flow)
5. [Simulation Agents (Detail)](#simulation-agents-detail)
   - [Input Validator](#1-input-validator)
   - [Director (Intent Interpreter)](#2-director-intent-interpreter)
   - [Depth Evaluator](#3-depth-evaluator)
   - [Evaluator (Competency Observer)](#4-evaluator-competency-observer)
   - [Domain Expert (Impact Analyst)](#5-domain-expert-impact-analyst)
   - [Narrator](#6-narrator)
6. [Authoring Agents](#authoring-agents)
   - [Canonical Case Generator](#7-canonical-case-generator)
   - [Authoring Assistant](#8-authoring-assistant)
7. [Guardrails System](#guardrails-system)
8. [Shared Data Structures](#shared-data-structures)
9. [LLM Provider Infrastructure](#llm-provider-infrastructure)
10. [Event Logging](#event-logging)
11. [Game State Machine](#game-state-machine)
12. [Version Lock](#version-lock)

---

## Overview

Academium uses a **multi-agent orchestration system** to process each student decision in a business simulation. When a student submits input, a pipeline of specialized AI agents — each with a single, narrow responsibility — collaborates to:

1. Validate the input is appropriate
2. Interpret the student's business intent
3. Evaluate the depth and quality of their reasoning
4. Calculate quantitative impacts on business indicators
5. Assess competencies (silently, for the professor)
6. Generate a narrative showing consequences

The agents follow a **"Stateful World, Stateless Agents"** pattern: all simulation state lives in PostgreSQL, and agents are pure functions that receive context, reason over it, and return structured output. No agent maintains internal memory between calls.

---

## Architecture Principles

### Stateless Agents, Stateful World
Agents do not remember previous calls. Every invocation receives a full `AgentContext` containing the scenario, current indicators, conversation history, and decision metadata. The Director coordinates state updates after all agents have contributed.

### Single Responsibility
Each agent does exactly one thing. The Narrator only writes stories. The Domain Expert only calculates numbers. The Evaluator only tracks competencies. This prevents conflicts and makes each agent's prompt focused and reliable.

### Fail-Open Design
When an agent fails (LLM timeout, malformed JSON, etc.), the system defaults to permissive behavior rather than blocking the student. For example, if the Director cannot parse the intent, it accepts the raw input as-is. If the Input Validator errors, the input is accepted.

### Parallel Where Possible
The Evaluator and Domain Expert run in parallel (`Promise.all`) since they are independent of each other. The Narrator runs after both complete because it needs their outputs.

### Consequence-Driven Learning
No agent ever tells the student they are "right" or "wrong." The system shows consequences of decisions through narrative and indicator changes, letting students draw their own conclusions. This is enforced through the Guardrails system.

---

## Agent Inventory

| Agent | File | Role | Runs When |
|---|---|---|---|
| Input Validator | `server/agents/inputValidator.ts` | Rejects gibberish/profanity | Before all other agents |
| Director | `server/agents/director.ts` | Orchestrator + Intent Interpreter | Every turn |
| Depth Evaluator | `server/agents/depthEvaluator.ts` | Checks reasoning quality | After intent interpretation |
| Evaluator | `server/agents/evaluator.ts` | Tracks competency scores (silent) | After depth passes |
| Domain Expert | `server/agents/domainExpert.ts` | Calculates indicator impacts | After depth passes (parallel with Evaluator) |
| Narrator | `server/agents/narrator.ts` | Generates consequence narrative | After Evaluator + Domain Expert |
| Case Generator | `server/agents/canonicalCaseGenerator.ts` | Creates scenario structures | During scenario authoring |
| Authoring Assistant | `server/agents/authoringAssistant.ts` | Helps professors build scenarios | During scenario authoring |

Supporting files:
- `server/agents/guardrails.ts` — Shared prompt constants enforcing behavioral rules
- `server/agents/constants.ts` — Version lock and structural constraints
- `server/agents/types.ts` — TypeScript interfaces for all agent inputs/outputs

---

## Orchestration Flow

The entire turn-processing pipeline is coordinated by `processStudentTurn()` in `server/agents/director.ts`.

```
Student submits input
        │
        ▼
┌─────────────────┐
│ Input Validator  │ ── Reject? ──► Return rejection message
│  (Pre-check)     │               (student text preserved)
└────────┬────────┘
         │ Accept
         ▼
┌─────────────────┐
│    Director      │ ── Invalid? ──► Return helpful prompt
│ (interpretIntent)│               (extremely rare)
└────────┬────────┘
         │ Interpreted action
         ▼
┌─────────────────┐
│ Depth Evaluator  │ ── Too shallow? ──► Return revision request
│ (evaluateDepth)  │                    (max 2 attempts)
└────────┬────────┘
         │ Deep enough
         ▼
┌────────────────────────────────┐
│        PARALLEL EXECUTION      │
│                                │
│  ┌──────────┐  ┌─────────────┐ │
│  │ Evaluator│  │Domain Expert│ │
│  │(scores)  │  │(indicators) │ │
│  └────┬─────┘  └──────┬──────┘ │
│       │               │        │
└───────┼───────────────┼────────┘
        │               │
        ▼               ▼
┌─────────────────────────────┐
│          Narrator            │
│  (generates consequence      │
│   narrative from both        │
│   agent outputs)             │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│     State Update             │
│  - Apply indicator deltas    │
│  - Update history            │
│  - Check game over           │
│  - Check reflection step     │
│  - Persist to database       │
└─────────────────────────────┘
              │
              ▼
        Response to student
```

### Timing (typical turn)
- Input Validator: ~200ms (lightweight model)
- Director (Intent): ~300ms
- Depth Evaluator: ~300ms
- Evaluator + Domain Expert (parallel): ~800ms combined
- Narrator: ~500ms
- **Total: ~2-3 seconds per turn**

---

## Simulation Agents (Detail)

### 1. Input Validator

**File:** `server/agents/inputValidator.ts`

**Purpose:** First line of defense. Prevents gibberish, profanity, and completely off-topic content from entering the pipeline. Designed to be **maximally permissive** — it only rejects content that has absolutely zero connection to any business context.

**Two-Stage Validation:**

1. **Quick Validation (regex, no LLM):**
   - Checks for profanity patterns (Spanish and English)
   - Catches keyboard spam (`asdfghjkl`, repeated characters)
   - Blocks extremely short input (< 3 characters)
   - Fast-path: if regex catches it, no LLM call needed

2. **LLM Validation (lightweight model):**
   - Uses `gpt-4o-mini` for speed
   - Only checks if input has *some* connection to the case context
   - Prompt bias: "When in doubt, ALWAYS accept"
   - Skipped entirely for Multiple Choice Questions without justification

**Output:** `InputValidationResult`
```typescript
{
  isValid: boolean;
  rejectionReason?: string;  // Internal logging
  userMessage?: string;      // Shown to student
}
```

**Key Behavior:** When input is rejected, the student's text is preserved in the input box (not cleared). The rejection message uses a locked, non-AI-generated format (`S6B_REJECTION_MESSAGE`) so the student always sees a consistent, friendly message.

**What gets accepted:** Typos, casual language, partial sentences, unconventional ideas, ethically questionable proposals (consequences teach the lesson), references to previous messages.

**What gets rejected:** Empty/whitespace, keyboard spam, profanity/threats, content with zero business connection.

---

### 2. Director (Intent Interpreter)

**File:** `server/agents/director.ts`

**Purpose:** The central orchestrator. It has two jobs:
1. **Interpret** the student's input into a clear business action
2. **Coordinate** the entire agent pipeline

**Intent Interpretation:**

The Director is an "Intent Interpreter" — it takes whatever the student writes (typos, slang, partial ideas) and transforms it into a clear, actionable business decision.

**Examples from the prompt:**
- `"empjuar a los desarrolladores"` → "Presionar a los desarrolladores para terminar a tiempo"
- `"darles café todos los días"` → "Mejorar amenidades del lugar de trabajo/moral"
- `"despedir a todos jaja"` → "Reducción dramática de costos/reestructuración"
- `"qué tal si mentimos"` → "Enfoque ético cuestionable" (let consequences teach)

**Output:**
```typescript
{
  isValid: boolean;
  interpretedAction?: string;  // Cleaned-up business action
  confidence: "high" | "medium" | "low";
  helpfulPrompt?: string;      // Only if isValid=false (extremely rare)
}
```

**Orchestration Logic (`processStudentTurn`):**
1. Call `interpretIntent()` — if invalid, return helpful prompt
2. Call `evaluateDepth()` — if too shallow, return revision request
3. Call `evaluateDecision()` and `calculateKPIImpact()` in parallel
4. Call `generateNarrative()` with both outputs
5. Apply indicator deltas, update state, check game over
6. Return complete turn response

**Reflection Handling:** After all 3 decision points, the Director switches to `processReflection()` which uses a simpler validation (only blocks profanity/empty/gibberish) and generates a closing narrative.

**Game Over Detection:** Checks if any indicator has fallen to critical levels:
- Morale, Reputation, Efficiency, Trust < 20
- Revenue < 10,000

---

### 3. Depth Evaluator

**File:** `server/agents/depthEvaluator.ts`

**Purpose:** Quality gate that checks whether a student's justification shows sufficient reasoning depth. Looks for at least one of: a stated priority, a case reference, or a trade-off acknowledgment.

**Key Constraints:**
- Never rejects based on length alone ("NO RECHAZAR POR LONGITUD")
- Maximum of 2 revision requests per decision (controlled by `MAX_REVISIONS = 2`)
- If the student has already revised once, accepts the response regardless

**Output:**
```typescript
{
  isDeepEnough: boolean;
  revisionPrompt?: string;          // "Mentor nudge" asking for more depth
  missingConsiderations?: string[];  // What was missing
  strengthsAcknowledged?: string;    // What the student did well
}
```

**Revision Flow:**
When `isDeepEnough` is false, the system returns the `revisionPrompt` as the narrative and sets `pendingRevision: true` in the state. The student's next input is treated as a revision of the same decision point, not a new turn.

---

### 4. Evaluator (Competency Observer)

**File:** `server/agents/evaluator.ts`

**Purpose:** Silently observes the student's decision and scores four competencies. These scores are **never shown to the student** — they exist only for the professor's analytics dashboard.

**Competencies Tracked:**
1. **Strategic Thinking** — Balancing long-term vs. short-term goals
2. **Ethical Reasoning** — Adherence to moral and legal standards
3. **Decision Decisiveness** — Acting with confidence and clarity
4. **Stakeholder Empathy** — Understanding impact on people

**Each competency is scored 1-5 and accompanied by flags:**
- Positive: `STRATEGIC_THINKER`, `RISK_AWARE`, `ETHICAL_LEADER`
- Negative: `SHORT_TERM_FOCUS`, `IGNORES_TEAM`, `AVOIDS_CONFLICT`

**Output:**
```typescript
{
  competencyScores: Record<string, number>;  // e.g., { strategicThinking: 4 }
  feedback: {
    score: number;
    message: string;  // Neutral observation (professor-facing)
    hint?: string;
  };
  flags: string[];  // e.g., ["STRATEGIC_THINKER", "RISK_AWARE"]
}
```

**Communication with Narrator:** The Evaluator's flags and neutral feedback are passed to the Narrator, which may use them to subtly shape the narrative tone — but never reveals scores or assessments to the student.

---

### 5. Domain Expert (Impact Analyst)

**File:** `server/agents/domainExpert.ts`

**Purpose:** The quantitative engine. Calculates how each student decision numerically affects business indicators, and provides causal explanations for every change.

**Dynamic Indicator Awareness:**
The Domain Expert's prompt is dynamically built from the actual scenario indicators. It doesn't use a static list — it reads the current scenario's indicator definitions (name, description, direction, initial value) and builds impact instructions specific to that scenario.

**Impact Tier System:**
- **Tier 1 (±3-6):** Routine operational adjustments
- **Tier 2 (±7-12):** Significant strategic shifts
- **Tier 3 (±13-20):** Transformative/crisis-level events (rare)

**Context Sensitivity:**
- The prompt includes all previous decisions and their impacts
- Each impact must cite the student's exact words
- Generic explanations are forbidden — reasoning must reference specific scenario elements

**Output:**
```typescript
{
  kpiDeltas: Record<string, number>;              // Legacy KPI changes
  indicatorDeltas?: Record<string, number>;       // Indicator-specific changes
  reasoning: string;                              // Overall reasoning
  expertInsight?: string;                         // Subject matter context
  metricExplanations?: Record<string, {
    shortReason: string;      // One-line visible explanation
    causalChain: string[];    // 2-4 bullet expandable chain
    tier: 1 | 2 | 3;         // Impact severity
  }>;
}
```

**Indicator Directionality:**
Each indicator has a `direction` property (`up_better` or `down_better`). The Domain Expert respects this — for example, `operationalRisk` is `down_better`, so reducing it is positive. This directionality flows through to the UI's delta coloring and the results page status computation.

**"Why Did This Change?" Explainability:**
The `metricExplanations` field powers the "Ver por qué cambió" feature in the student cockpit. Each indicator change includes:
- A short reason (visible by default)
- A causal chain (expandable, 2-4 bullets: what → why → effect → magnitude)

---

### 6. Narrator

**File:** `server/agents/narrator.ts`

**Purpose:** Transforms raw data from the Evaluator and Domain Expert into an immersive, consequence-focused narrative that the student reads as the simulation response.

**Narrative Structure (mandatory):**
1. **Statement of Consequence** — What happened as a direct result of the decision
2. **Stakeholder Reaction** — How a specific person/group in the scenario reacted
3. **Forward Pressure** — The next challenge or tension that emerges

**Constraints:**
- 60-100 words per narrative
- Latin American Spanish, professional tone
- Never judges, never reveals optimal answers
- Never uses emojis
- Consequence-focused, not lecture-focused

**Inputs:**
- `AgentContext` (scenario, history, decision)
- `DomainExpertOutput` (what changed and why)
- `EvaluatorOutput` (feedback flags for subtle tone shaping)

**Output:**
```typescript
{
  text: string;                  // The narrative paragraph
  speaker?: string;              // Optional NPC name (e.g., "Marcus")
  mood: "neutral" | "positive" | "negative" | "crisis";
  suggestedOptions?: string[];   // Next decision options (for MCQ turns)
}
```

**NPC System:**
The Narrator can attribute its response to an NPC character (defined in `types.ts`):
- **Marcus** (CFO) — Triggered by financial decisions, skeptical about costs
- **Sarah** (Operations Manager) — Triggered by team decisions, empathetic but urgent
- **Victor** (Board Member) — Triggered by performance concerns, aggressive
- **Alex** (Junior Analyst) — Triggered by ethical dilemmas, idealistic

When an NPC speaks, the narrative is attributed to them and the UI displays their name and role.

---

## Authoring Agents

These agents help professors create simulation scenarios. They run during the authoring process, not during student simulations.

### 7. Canonical Case Generator

**File:** `server/agents/canonicalCaseGenerator.ts`

**Purpose:** Generates complete, structured business cases following the Academium canonical format (inspired by Harvard case study structure).

**Output Structure:**
- Title and challenge description
- 120-180 word context paragraph
- Exactly 3 decision points (progressive complexity):
  - Decision 1: Multiple choice (orientation)
  - Decision 2: Analytical (deeper reasoning required)
  - Decision 3: Integrative (synthesis of trade-offs)
- 4 indicators with names, descriptions, initial values, and directionality
- Focus cues and thinking scaffolds for each decision point

**Thinking Scaffolds:**
Each decision point includes "thinking scaffolds" — prompts that guide *how* to think about the decision without suggesting *what* to decide. For example: "Consider: What are the short-term vs. long-term implications?" rather than "You should prioritize long-term growth."

---

### 8. Authoring Assistant

**File:** `server/agents/authoringAssistant.ts`

**Purpose:** A multi-stage assistant that helps professors create and refine scenarios through a conversational workflow.

**Three Components:**

1. **Insight Extractor** — Analyzes raw source material (uploaded PDFs, articles, case descriptions) to identify key characters, challenges, decision points, and ethical tensions.

2. **Scenario Architect** — Takes extracted insights and builds a complete scenario following the canonical structure. Produces all the fields needed for a playable simulation.

3. **Refinement Assistant** — A conversational agent that lets the professor modify specific aspects of a generated scenario through natural language chat. For example: "Add a stakeholder who represents the employees" or "Make the third decision point about sustainability."

---

## Guardrails System

**File:** `server/agents/guardrails.ts`

The guardrails are not an agent — they are shared prompt constants that are imported by nearly every simulation agent. They enforce non-negotiable behavioral rules across the entire AI system.

### HARD_PROHIBITIONS (8 rules)
1. Never give the "correct" answer
2. Never visibly grade or score
3. Never optimize for GPA
4. Never reference "what the professor wants"
5. Never reveal internal evaluation logic
6. Never respond emotionally or sarcastically
7. Never mirror profanity or inappropriate language
8. Never break the professional academic tone

### MENTOR_TONE
Defines the personality: calm, professional, encouraging without being condescending, realistic, constructive. Uses Latin American Spanish, formal but accessible.

### MISUSE_HANDLING
De-escalation strategy for students who troll, joke, write nonsense, or use profanity:
1. De-escalate — don't confront or judge
2. Redirect — return to the simulation context
3. Maintain tone — act as if nothing happened

### IMPLICIT_ETHICS_RULE
Ethics must emerge implicitly through consequences, never through direct questions like "Is this ethical?" If a student fires employees without notice, the narrative shows consequences (resignations in solidarity, union complaints) rather than asking moral questions.

### POC_SPANISH_ONLY
All generated content must be in Latin American Spanish. Zero English words — even common anglicisms like "stakeholders" must be translated to "partes interesadas."

### FINAL_CLOSURE_GUIDELINES
Rules for the end-of-simulation message: must provide closure and meaning without judgment. Summarizes trajectory, acknowledges effort, and leaves the future open.

---

## Shared Data Structures

### AgentContext (input to all agents)
```typescript
interface AgentContext {
  sessionId: string;
  turnCount: number;
  currentKpis: KPIs;
  indicators?: Indicator[];
  history: { role: string; content: string; speaker?: string }[];
  studentInput: string;
  totalDecisions?: number;
  currentDecision?: number;
  decisionPoints?: DecisionPoint[];
  llmModel?: SupportedModel;
  agentPrompts?: AgentPrompts;
  scenario: {
    title: string;
    domain: string;
    role: string;
    objective: string;
    companyName?: string;
    industry?: string;
    stakeholders?: Array<{ name: string; role: string; interests: string }>;
    learningObjectives?: string[];
    ethicalDimensions?: string[];
    // ... additional context fields
  };
}
```

### SimulationState (persisted after each turn)
```typescript
interface SimulationState {
  turnCount: number;
  kpis: KPIs;
  indicators?: Indicator[];
  history: HistoryEntry[];
  flags: string[];
  rubricScores: Record<string, number>;
  currentDecision?: number;
  isComplete?: boolean;
  isReflectionStep?: boolean;
  reflectionCompleted?: boolean;
  pendingRevision?: boolean;
  revisionAttempts?: number;
}
```

---

## LLM Provider Infrastructure

**Directory:** `server/llm/`

The agent system sits on top of a robust, multi-provider LLM infrastructure designed for high availability.

### Provider Abstraction Layer

Each LLM provider implements a `ProviderAdapter` interface through a `BaseProvider` abstract class that handles:
- **Concurrency limiting** via `p-limit` (per-provider slot limits)
- **Latency tracking** via Exponential Moving Average
- **Error classification** (rate limits vs. server errors vs. timeouts)

**Supported Providers:**
| Provider | File | Models |
|---|---|---|
| Replit OpenAI Proxy | `replitOpenai.ts` | gpt-4o, gpt-4o-mini |
| Replit Gemini Proxy | `replitGemini.ts` | gemini-2.5-flash |
| OpenRouter | `openrouter.ts` | Multiple via routing |
| Gemini Direct | `geminiDirect.ts` | gemini-2.5-flash, gemini-2.5-pro |
| OpenAI Direct | `openaiDirect.ts` | gpt-4o, gpt-4o-mini |
| Anthropic | `anthropic.ts` | claude-sonnet-4-20250514 |

### Provider Registry
`server/llm/providers/registry.ts`

Manages all providers at startup:
- Reads environment variables to determine which providers to enable
- Supports **multi-key rotation** — comma-separated API keys are parsed and rotated round-robin to multiply rate limits
- Tracks health, active requests, and capacity across all providers

### Smart Router
`server/llm/providers/router.ts`

Selects the best provider for each request:
1. Filter out unhealthy or rate-limited providers
2. Prefer cheaper providers (cost tier)
3. Balance load by utilization ratio (active requests / max capacity)
4. **Automatic failover**: if a provider fails, immediately retry with the next best provider
5. **Model equivalence**: maps generic model requests to provider-specific model strings (e.g., a `gpt-4o` request can failover to `claude-sonnet-4-20250514` on Anthropic)

### Two-Level Queuing

**Job Queue** (`server/llm/providers/queue.ts`):
Low-level queue for individual LLM completion calls. When all provider slots are full, requests are enqueued and processed as slots free up.

**Turn Queue** (`server/llm/turnQueue.ts`):
High-level queue for complete student turns. A multi-agent turn requires ~4 LLM calls, so the turn queue reserves `SLOTS_PER_TURN = 4` slots before starting. If capacity is insufficient, returns `202 Accepted` with a Job ID. The frontend polls for results while the turn waits for capacity.

---

## Event Logging

Every agent call during turn processing is logged to the `turn_events` table in PostgreSQL. Each event captures:

- `sessionId` — Which simulation session
- `eventType` — `"agent_call"`, `"input_rejected"`, `"input_accepted"`, `"turn_complete"`, `"error"`
- `turnNumber` — Which decision point
- `rawStudentInput` — The verbatim student text
- `eventData` — Agent-specific output (JSON):
  - Director: `isValid`, `interpretedAction`, duration
  - Depth Evaluator: `isDeepEnough`, `revisionPrompt`, attempts
  - Evaluator: competency scores, flags, feedback
  - Domain Expert: indicator deltas, metric explanations
  - Narrator: mood, speaker, narrative length

Professors can view the complete event log for any session via the "Registro de Eventos" tab in the session detail dialog on the ScenarioAnalytics page.

---

## Game State Machine

```
┌──────────┐     Input      ┌──────────────┐
│  START   │ ──────────────► │  Decision 1  │
└──────────┘                 │  (MCQ)       │
                             └──────┬───────┘
                                    │
                             ┌──────▼───────┐
                             │  Decision 2  │
                             │  (Analytical)│
                             └──────┬───────┘
                                    │
                             ┌──────▼───────┐
                             │  Decision 3  │
                             │ (Integrative)│
                             └──────┬───────┘
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
             ┌──────▼───────┐      │        ┌──────▼───────┐
             │  Reflection  │      │        │  Game Over   │
             │  (Step 4)    │      │        │  (KPI < 20)  │
             └──────┬───────┘      │        └──────────────┘
                    │              │
             ┌──────▼───────┐      │
             │  COMPLETED   │◄─────┘
             └──────────────┘
```

**Decision Points:** Each scenario has exactly 3, with progressive complexity.

**Revision Loop:** At any decision point, the Depth Evaluator may request up to 2 revisions before accepting the response.

**Reflection Step:** After all 3 decisions (if no game over), the student enters a reflection step with loose validation (only blocks profanity/empty/gibberish).

**Game Over:** Triggered when any core indicator drops below 20 (or revenue below 10,000). The simulation ends immediately with a closure narrative.

---

## Version Lock

**File:** `server/agents/constants.ts`

The POC (v1.0) structure is explicitly locked:

```
POC v1.0 — LOCKED
├── Canonical Case Structure (120-180 word context)
├── 3 Decision Points
├── 4 POC Indicators (teamMorale, budgetHealth, operationalRisk, strategicFlexibility)
├── 1 Reflection Prompt
├── Multi-agent orchestration (Director, Narrator, Evaluator, DomainExpert, DepthEvaluator)
├── 8 Hard Prohibitions (guardrails)
├── Relevance+Structure Validation (no length quota, max 1 revision)
└── Faculty Visibility Dashboard (no scores displayed to students)
```

**Future versions (planned):**
- **v2.0** — Adaptive difficulty, expanded indicators, multi-path branching
- **v3.0** — Rubric-based grading, cross-session analytics, LMS export
