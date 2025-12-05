# SIMULEARN Engine: Multi-Agent Orchestration & Logic (Spec 02)

**Target Audience:** AI Coding Agent / Python Developer
**Purpose:** Define the specific agents, their personas, responsibilities, and the orchestration logic (LangGraph/LangChain) that governs their interaction.
**Context:** This is the "Brain" service defined in Spec 01.

---

## 1. The Agent Swarm Topology
**Pattern:** Hierarchical Supervisor Pattern (or "Manager-Worker").
**Supervisor:** `SimulationDirector` (Routes tasks, maintains consistency).
**Workers:** Specialized agents for narrative, assessment, and domain logic.

### The Roster (Agent Personas)

#### A. The Director (`SimulationDirector`)
*   **Role:** Orchestrator & State Keeper.
*   **Responsibility:** Receives the student input. Decides which workers need to act. Aggregates their outputs into a final JSON response.
*   **Key Trait:** Strict adherence to JSON schema. Does not hallucinate new plot points directly; delegates to the Narrator.

#### B. The Narrator (`ScenarioWeaver`)
*   **Role:** Storyteller & World Builder.
*   **Responsibility:** Generates the "What happens next" text.
*   **Input:** Current State + Student Action + Consequence Flags.
*   **Output:** Narrative paragraph + Dialogue from NPCs.
*   **Vibe:** Professional, immersive, high-stakes business tone.

#### C. The Evaluator (`CompetencyAssessor`)
*   **Role:** Grader & Critic.
*   **Responsibility:** Analyzes the student's decision against the Rubric.
*   **Input:** Student Action + Rubric Criteria.
*   **Output:** Hidden scores (0-100), feedback strings, and "Flags" (e.g., `RISK_TAKER`, `ETHICAL_LAPSE`).

#### D. The Domain Expert (`BusinessLogicEngine`)
*   **Role:** The Calculator.
*   **Responsibility:** Updates the quantitative state (KPIs).
*   **Input:** Student Action + Current KPIs.
*   **Output:** KPI deltas (e.g., `Revenue: -5%`, `TeamMorale: +10`).
*   **Logic:** "If student fires the manager, Morale drops by 20."

---

## 2. Orchestration Flow (The "Turn" Logic)

When a student submits an action, the `SimulationDirector` executes this chain:

1.  **Step 1: Intent Analysis**
    *   Director asks: "Is this a valid attempt to solve the problem, or is it gibberish/off-topic?"
    *   *If Invalid:* Return "Clarification Request" immediately.

2.  **Step 2: Parallel Execution (The "Think" Phase)**
    *   **Evaluator** assesses the quality of the decision.
    *   **Domain Expert** calculates the KPI impact.
    *   *Note:* These run in parallel to save time.

3.  **Step 3: Synthesis (The "Update" Phase)**
    *   Director updates the `SimulationState` with new scores and KPIs.

4.  **Step 4: Narrative Generation (The "React" Phase)**
    *   **Narrator** is called with the *updated* state.
    *   Prompt: "Given that Morale just dropped by 20% and the student was rude, write a scene where the team reacts negatively."

5.  **Step 5: Final Polish**
    *   Director formats everything into the standard `TurnResponse` JSON schema.

---

## 3. Prompt Engineering Strategy (Vibe Coding Instructions)

### System Prompt Template (for all agents)
```text
You are a component of the SIMULEARN Engine.
Your output MUST be valid JSON.
Do not include markdown formatting (```json).
Adhere strictly to the following schema: {schema_definition}.
Current Context: {context_summary}.
```

### Specific Prompt: The Evaluator
```text
Analyze the student's response: "{student_input}".
Compare it against the Rubric Criteria: {rubric_json}.
For each criterion, assign a score (1-5) and a brief justification.
Identify any "Red Flags" (e.g., illegal action, rude tone).
```

### Specific Prompt: The Narrator
```text
Write the next scene (max 150 words).
Tone: {simulation_tone} (e.g., Tense, Corporate, Crisis).
Outcome: The student's decision led to {outcome_summary}.
Include a quote from NPC {npc_name} that reflects their reaction.
Ends with a "Call to Action" for the next decision.
```

---

## 4. State Object Structure (The "Memory")
The agents pass this object around. It is the Holy Grail.

```json
{
  "session_id": "12345",
  "turn_count": 3,
  "kpis": {
    "revenue": 100000,
    "morale": 75,
    "reputation": 50
  },
  "history": [
    { "role": "system", "content": "Intro..." },
    { "role": "user", "content": "I fire the manager." },
    { "role": "system", "content": "The team revolts..." }
  ],
  "flags": ["manager_fired", "union_strike_risk"],
  "rubric_scores": {
    "leadership": 2.5,
    "financial_acumen": 4.0
  }
}
```
