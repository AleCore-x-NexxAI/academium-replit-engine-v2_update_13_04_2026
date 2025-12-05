# SIMULEARN Engine: Business Simulation Domain Rules (Spec 05)

**Target Audience:** Domain Expert / Prompt Engineer
**Purpose:** Define the specific logic, KPIs, and cause-and-effect relationships for the "Business" use case.
**Context:** This document feeds the `BusinessLogicEngine` agent defined in Spec 02.

---

## 1. The Standard Business Model (SBM)
Every business simulation in SIMULEARN runs on a standardized set of 5 Core KPIs. This ensures consistency across different scenarios (Marketing, HR, Strategy).

### The 5 Core KPIs
1.  **Revenue / Profitability (`$`)**: The financial health.
2.  **Team Morale (`%`)**: The internal culture and motivation.
3.  **Brand Reputation (`%`)**: The external public perception.
4.  **Operational Efficiency (`%`)**: How smoothly things run (Risk of errors).
5.  **Stakeholder Trust (`%`)**: Confidence from the Board/Investors.

*   **Starting State:** All % metrics start at 75% (Neutral/Good). Revenue starts at scenario-specific baseline.
*   **Game Over Conditions:** Any metric dropping below 20% triggers a "Failure State" (e.g., Bankruptcy, Strike, Scandal).

---

## 2. Cause-and-Effect Logic (The Rulebook)

The `BusinessLogicEngine` agent uses these rules to calculate deltas.

### Rule Set A: Crisis Management
*   **Scenario:** Public Scandal (e.g., Data Breach).
*   **Action:** "Deny everything."
    *   `Reputation`: -20% (The lie is caught).
    *   `Trust`: -15%.
    *   `Morale`: -5% (Employees are embarrassed).
*   **Action:** "Apologize and offer compensation."
    *   `Revenue`: -10% (Cost of payout).
    *   `Reputation`: +5% (Recovery).
    *   `Trust`: +5%.

### Rule Set B: Team Leadership
*   **Scenario:** Missed Deadline.
*   **Action:** "Force overtime (Crunch)."
    *   `Efficiency`: +10% (Short term).
    *   `Morale`: -15% (Burnout).
*   **Action:** "Delay the launch."
    *   `Revenue`: -5% (Missed window).
    *   `Morale`: +5% (Relief).
    *   `Reputation`: -2% (Disappointed customers).

---

## 3. Competency Framework (The Grading Key)

The `CompetencyAssessor` agent scores decisions based on these dimensions:

| Competency | Definition | Positive Indicators | Negative Indicators |
| :--- | :--- | :--- | :--- |
| **Strategic Thinking** | Balancing long-term vs short-term. | Sacrifices short-term profit for long-term growth. | Fixates on immediate quarterly numbers only. |
| **Ethical Reasoning** | Adhering to moral/legal standards. | Prioritizes safety/honesty over profit. | Hides data, lies to stakeholders, cuts corners. |
| **Decision Decisiveness** | Acting with confidence and clarity. | Clear instructions, owns the outcome. | Vague language, blames others, delays action. |
| **Stakeholder Empathy** | Understanding impact on others. | Acknowledges team feelings, customer pain. | Ignores human cost, treats people as numbers. |

---

## 4. NPC Archetypes
To make the simulation feel alive, the `ScenarioWeaver` (Narrator) uses these stock characters:

*   **The Skeptical CFO (Marcus):** Always questions the cost. "Can we afford this?"
*   **The Overworked Manager (Sarah):** Represents the team's morale. "The team is breaking, boss."
*   **The Aggressive Board Member (Victor):** Demands results now. "I don't care how, just fix it."
*   **The Idealistic Intern (Alex):** Represents the ethical conscience. "Is this actually right?"

**Prompt Instruction:** "When the student proposes a risky financial move, have Marcus intervene with a warning."
