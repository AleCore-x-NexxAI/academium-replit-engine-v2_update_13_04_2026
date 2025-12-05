# SIMULEARN Engine: System Architecture & Tech Stack (Spec 01)

**Target Audience:** AI Coding Agent / Senior DevOps Engineer
**Purpose:** Define the high-level infrastructure, technology stack, and architectural patterns for the SIMULEARN Multi-Agent Simulation Engine.
**Context:** This system builds dynamic, text-based business simulations using a multi-agent AI core.

---

## 1. High-Level Architecture Pattern
**Pattern:** Event-Driven Microservices with Agentic Orchestration.
**Core Philosophy:** "Stateful World, Stateless Agents." The simulation state is the single source of truth; agents read state, reason, and propose updates.

### System Components
1.  **Frontend Client (The Stage):** React-based SPA for students (simulation interface) and professors (authoring dashboard).
2.  **API Gateway (The Doorman):** Manages auth, rate limiting, and routes requests to the backend.
3.  **Core Backend (The World Server):** Manages simulation state, user sessions, and database persistence.
4.  **Agent Orchestrator (The Brain):** A dedicated service (Python) that hosts the multi-agent swarm. It receives "context" and returns "decisions/content".
5.  **Vector Memory (The Library):** Stores RAG knowledge (business cases, pedagogical frameworks) for agents to query.

---

## 2. Technology Stack (Strict Constraints)

### Frontend
*   **Framework:** Next.js 14+ (App Router)
*   **Language:** TypeScript 5.x (Strict Mode)
*   **Styling:** Tailwind CSS 4.0 + shadcn/ui (Radix Primitives)
*   **State Management:** Zustand (Client State) + TanStack Query (Server State)
*   **Real-time:** Socket.io-client or SSE (Server-Sent Events) for streaming agent tokens.

### Backend (Core API)
*   **Runtime:** Node.js 20+ (or Python FastAPI if preferred for unified stack, but Node is better for high-concurrency I/O). *Recommendation: Node.js/Express or NestJS for API, Python for Agents.*
*   **Language:** TypeScript
*   **Database (Relational):** PostgreSQL 16 (Supabase or AWS RDS)
*   **ORM:** Drizzle ORM (Schema-first, type-safe)

### Agent Service (The "Brain")
*   **Runtime:** Python 3.11+
*   **Framework:** FastAPI (for exposing agents as microservices) or LangGraph/LangChain for orchestration.
*   **LLM Interface:** OpenAI API (GPT-4o for reasoning, GPT-4o-mini for speed) or Anthropic Claude 3.5 Sonnet.
*   **Vector DB:** Pinecone or pgvector (inside PostgreSQL).

### Infrastructure
*   **Containerization:** Docker + Docker Compose (for local dev).
*   **Queue:** Redis (BullMQ) for async agent tasks (e.g., "Generate full scenario").
*   **Auth:** Clerk or NextAuth.js (JWT-based).

---

## 3. Data Flow Architecture

### Flow A: The "Game Loop" (Student Move)
1.  **Student** submits a decision (text input) via Frontend.
2.  **Backend** saves input to DB `SimulationState`.
3.  **Backend** pushes a job `ProcessTurn` to Redis Queue.
4.  **Agent Service** picks up job:
    *   Retrieves current `SimulationState`.
    *   **Agent Swarm** activates (See Spec 02).
    *   Calculates consequences, updates KPIs, generates feedback.
5.  **Agent Service** returns updated state to Backend.
6.  **Backend** pushes update to Frontend via WebSocket/SSE.

### Flow B: The "Authoring Loop" (Professor Create)
1.  **Professor** uploads a PDF case study.
2.  **Backend** parses text and stores in Vector DB.
3.  **Agent Service** (`CaseArchitect` Agent) analyzes text and drafts a `ScenarioBlueprint` (JSON).
4.  **Frontend** renders the Blueprint for Professor review.

---

## 4. Security & Scalability
*   **Sandboxing:** Agents cannot execute arbitrary code. They output structured JSON only.
*   **Rate Limiting:** Per-user token limits to control LLM costs.
*   **Concurrency:** Redis Queue ensures agents aren't overwhelmed by 1000 simultaneous students.

---

## 5. Directory Structure (Monorepo Recommendation)
```text
/apps
  /web           (Next.js Frontend)
  /api           (Node.js Core Backend)
  /brain         (Python Agent Service)
/packages
  /db            (Drizzle Schema & Migrations)
  /shared        (Shared Types/Interfaces)
/infra           (Docker, Terraform)
```
