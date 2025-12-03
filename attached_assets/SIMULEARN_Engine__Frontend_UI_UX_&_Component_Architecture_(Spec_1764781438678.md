# SIMULEARN Engine: Frontend UI/UX & Component Architecture (Spec 04)

**Target Audience:** Frontend Developer / UX Designer
**Purpose:** Define the visual structure, component hierarchy, and user experience flows for the simulation interface.
**Context:** This is the "Face" of the system, built with React, Tailwind, and shadcn/ui.

---

## 1. Core Layouts

### The Simulation Interface (`/simulations/:id`)
This is the primary view where students spend 90% of their time. It follows a "Cockpit" layout.

*   **Left Panel (The Context):**
    *   **Scenario Info:** Title, Role, Current Objective.
    *   **KPI Dashboard:** Live charts (Recharts) showing `Revenue`, `Morale`, `Trust`. These animate when updated.
    *   **Inventory/Assets:** (Optional) PDF documents or emails the student has collected.

*   **Center Panel (The Feed):**
    *   **Chat Stream:** A scrollable feed of the narrative history.
    *   **Message Bubbles:** Distinct styles for "System" (Narrator), "NPCs" (Dialogue), and "Student" (Actions).
    *   **Input Area:** A rich text area (or simple textarea) for typing decisions.
    *   **Action Buttons:** "Submit", "Ask for Hint", "Review Rubric".

*   **Right Panel (The Feedback Loop):**
    *   **Micro-Feedback Card:** Appears after every turn. Shows "Why this happened."
    *   **Competency Radar:** A spider chart showing the student's evolving strengths (e.g., "Leadership" vs "Analysis").

### The Authoring Studio (`/studio`)
A clean, Notion-like interface for professors.

*   **Wizard Step 1:** Upload PDF / Enter Prompt.
*   **Wizard Step 2:** "The Blueprint View" – A tree visualization (React Flow) showing the generated decision nodes.
*   **Wizard Step 3:** "The Tweak Panel" – Click any node to edit the text or logic.

---

## 2. Key Components (React/shadcn)

### `SimulationFeed.tsx`
*   **Props:** `history: Turn[]`, `isTyping: boolean`
*   **Behavior:** Auto-scrolls to bottom on new message. Renders markdown content safely.

### `KPIDashboard.tsx`
*   **Props:** `metrics: Record<string, number>`
*   **Behavior:** Uses `framer-motion` to animate number changes (e.g., counting up from 75% to 80%).
*   **Visuals:** Green up-arrows for positive deltas, red down-arrows for negative.

### `InputConsole.tsx`
*   **Props:** `onSubmit: (text: string) => void`, `mode: 'guided' | 'assessment'`
*   **Logic:**
    *   If `mode === 'guided'`, show "Suggested Options" chips above the text box.
    *   If `mode === 'assessment'`, show only the text box.
    *   **Debounce:** Prevent double submissions.

---

## 3. State Management (Zustand)

We avoid "Prop Drilling" by using a global store for the active session.

```typescript
interface SimulationStore {
  // State
  sessionId: string | null;
  history: Turn[];
  kpis: Record<string, number>;
  isProcessing: boolean; // True when agents are thinking
  
  // Actions
  addTurn: (turn: Turn) => void;
  updateKPIs: (updates: KPIUpdate) => void;
  setProcessing: (status: boolean) => void;
}
```

---

## 4. UX Micro-Interactions
*   **The "Thinking" State:** When the student submits, do NOT just show a spinner. Show a "System Status" log:
    *   *Analyzing intent...*
    *   *Consulting Legal Dept...*
    *   *Updating Financial Models...*
    *   *Generating Outcome...*
    *   **Why?** It sells the "AI Simulation" fantasy and masks latency.

*   **Error Handling:** If the websocket disconnects, show a "Reconnecting to HQ..." banner, not a generic 404.
