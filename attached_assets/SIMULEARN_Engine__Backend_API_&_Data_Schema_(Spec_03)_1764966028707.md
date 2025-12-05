# SIMULEARN Engine: Backend API & Data Schema (Spec 03)

**Target Audience:** Backend Developer / Database Architect
**Purpose:** Define the database schema (PostgreSQL/Drizzle) and the REST API endpoints that the Frontend and Agent Service will use.
**Context:** This is the "Backbone" of the system.

---

## 1. Database Schema (Drizzle ORM)

### Table: `users`
*   `id`: uuid (PK)
*   `email`: varchar (unique)
*   `role`: enum ('student', 'professor', 'admin')
*   `created_at`: timestamp

### Table: `scenarios` (The Blueprints)
*   `id`: uuid (PK)
*   `author_id`: uuid (FK -> users.id)
*   `title`: varchar
*   `description`: text
*   `domain`: varchar (e.g., 'Marketing', 'Ethics')
*   `initial_state`: jsonb (Default KPIs, Intro text)
*   `rubric`: jsonb (Criteria and scoring rules)
*   `is_published`: boolean

### Table: `sessions` (Active Simulations)
*   `id`: uuid (PK)
*   `user_id`: uuid (FK -> users.id)
*   `scenario_id`: uuid (FK -> scenarios.id)
*   `current_state`: jsonb (The "Memory" object from Spec 02)
*   `status`: enum ('active', 'completed', 'abandoned')
*   `score_summary`: jsonb (Final grades)

### Table: `turns` (The History Log)
*   `id`: uuid (PK)
*   `session_id`: uuid (FK -> sessions.id)
*   `turn_number`: integer
*   `student_input`: text
*   `agent_response`: jsonb (Full output from Director)
*   `created_at`: timestamp

---

## 2. API Endpoints (REST)

### Auth Group
*   `POST /auth/login` -> Returns JWT
*   `POST /auth/register`

### Simulation Group (Student)
*   `POST /simulations/start`
    *   **Body:** `{ scenario_id: "..." }`
    *   **Response:** `{ session_id: "...", initial_state: {...} }`
*   `POST /simulations/:session_id/turn`
    *   **Body:** `{ input: "I choose option B..." }`
    *   **Response:** (Streamed) `{ narrative: "...", kpi_updates: {...}, feedback: "..." }`
*   `GET /simulations/:session_id/history`
    *   **Response:** List of past turns.

### Authoring Group (Professor)
*   `POST /scenarios/generate`
    *   **Body:** `{ file: (PDF), prompt: "Make a crisis sim..." }`
    *   **Action:** Triggers async job to Agent Service.
*   `GET /scenarios/:id`
*   `PUT /scenarios/:id` (Update rubric/text)

---

## 3. API Contracts (JSON Types)

### `TurnResponse` (The Standard Output)
This is what the Frontend receives after every move.

```typescript
interface TurnResponse {
  narrative: {
    text: string; // The story update
    speaker?: string; // If an NPC is talking
    mood: "neutral" | "positive" | "negative" | "crisis";
  };
  kpi_updates: {
    [key: string]: {
      value: number;
      delta: number; // e.g., -5
    };
  };
  feedback: {
    score: number; // Internal micro-score
    message: string; // "Good job considering the stakeholders."
    hint?: string; // Optional guidance
  };
  options?: string[]; // If in Guided Mode
  is_game_over: boolean;
}
```

---

## 4. Real-Time Strategy
*   **Streaming:** The `/turn` endpoint should use **Server-Sent Events (SSE)**.
*   **Why?** LLM generation takes 3-10 seconds. We cannot make the user wait for a blank screen.
*   **Events:**
    *   `event: thinking` -> "Agents are analyzing..."
    *   `event: token` -> "The" "CEO" "looks" "angry..." (Text streaming)
    *   `event: kpi` -> Update charts immediately.
    *   `event: done` -> Enable input field.
