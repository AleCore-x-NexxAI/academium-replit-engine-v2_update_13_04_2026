# SIMULEARN Engine

## Overview
SIMULEARN is an AI-powered business simulation platform for experiential learning. It enables students to practice real-world decision-making in dynamic, text-based scenarios. Professors can author and customize simulation blueprints. The platform uses a multi-agent AI architecture to generate immersive narratives, evaluate student decisions, calculate business impacts, and provide real-time feedback. Key capabilities include an interactive student "cockpit" with KPI dashboards, a professor authoring studio, and a multi-agent AI core for narrative generation, competency assessment, and business logic.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
The frontend is built with React and TypeScript, utilizing Vite. UI components are developed using `shadcn/ui` on Radix UI primitives with Tailwind CSS, following a "Design System Approach" inspired by Fluent Design for professional credibility and cognitive load management. Typography uses Inter for UI/body text and JetBrains Mono for data. The simulation cockpit uses a three-column grid layout for context, narrative, and feedback. State management relies on Zustand for client-side state and TanStack Query for server state and caching, with real-time updates and optimistic UI.

### Backend Architecture
The backend is an Express.js (Node.js) REST API, serving as the "World Server." It uses PostgreSQL with Drizzle ORM for type-safe data management. Authentication is handled by Replit Auth (OpenID Connect) with `express-session`. A JavaScript-based multi-agent orchestration system (using LangChain.js patterns) processes student turns. This system includes specialized AI agents: `SimulationDirector` (orchestrator), `ScenarioWeaver/Narrator` (narrative generation), `CompetencyAssessor/Evaluator` (decision scoring), and `BusinessLogicEngine/DomainExpert` (KPI calculation). LLM integration uses OpenAI GPT-4o via Replit AI Integrations. The system follows a "Stateful World, Stateless Agents" pattern where simulation state is stored in PostgreSQL, and agents reason without maintaining internal state.

### Data Architecture
Core database tables include `users`, `scenarios`, `simulation_sessions`, `turns`, and `sessions`. Key data structures like `SimulationState` (JSONB for KPIs, history, scores), `KPIs`, `Rubric` (JSONB for scoring criteria), and `HistoryEntry` (role-based messages) are central to the system.

### API Design
The API provides RESTful endpoints for managing scenarios, simulations, and user authentication. Key endpoints facilitate starting new simulations, submitting student turns, and retrieving session data. The turn processing flow involves the client submitting input, the backend invoking the agent service, agents executing their workflow, and the backend persisting the turn and returning the response.

### Design Patterns
The system employs event-driven updates with optimistic UI, a hierarchical agent pattern (Director managing worker agents), component composition using atomic design principles, and end-to-end type safety with shared schema types.

## External Dependencies

### Third-Party Services
- **Replit Infrastructure**: Replit Auth (OpenID Connect), Replit Object Storage (via Google Cloud Storage client), Replit AI Integrations (OpenAI proxy).
- **AI/LLM Services**: OpenAI API (GPT-4o, GPT-4o-mini), configured via environment variables.

### Database
- **PostgreSQL**: Accessed via Neon serverless driver for connection pooling and edge-compatible connections, configured via `DATABASE_URL`.

### Key NPM Packages
- **Frontend**: React, Wouter, Radix UI, Framer Motion, Recharts, TanStack Query, Zustand.
- **Backend**: Express.js, Drizzle ORM, Passport.js, `express-session`, `p-limit`, `p-retry`.
- **Development**: Vite, esbuild, tsx, Tailwind CSS.

### File Storage
- **Google Cloud Storage**: Used for PDF case study uploads in the Authoring Studio, integrated via `@google-cloud/storage`.