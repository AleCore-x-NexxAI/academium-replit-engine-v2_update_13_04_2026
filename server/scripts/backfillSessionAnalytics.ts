import { storage } from "../storage";
import { db } from "../db";
import { simulationSessions, scenarios } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { generateDashboardSummary } from "../agents/director";
import type {
  SimulationSession,
  Scenario,
  Turn,
  SimulationState,
  DecisionEvidenceLogEntry,
  FrameworkDetection,
  TurnResponse,
} from "@shared/schema";
import type { AgentContext } from "../agents/types";

export interface BackfillResult {
  sessionId: string;
  status:
    | "skipped_not_completed"
    | "skipped_already_populated"
    | "skipped_no_turns"
    | "skipped_no_evidence_in_turns"
    | "repaired"
    | "repaired_logs_only"
    | "would_repair"
    | "error";
  message?: string;
  reconstructedTurnCount?: number;
}

export interface BackfillSummary {
  scanned: number;
  repaired: number;
  wouldRepair: number;
  skipped: number;
  errors: number;
  results: BackfillResult[];
}

interface BackfillOptions {
  sessionId?: string;
  dryRun?: boolean;
  scenarioId?: string;
}

function needsRepair(
  state: SimulationState | undefined | null,
  scenarioHasFrameworks: boolean,
): boolean {
  if (!state) return false;
  const noLogs = !state.decisionEvidenceLogs || state.decisionEvidenceLogs.length === 0;
  const noSummary = !state.dashboard_summary;
  if (noLogs || noSummary) return true;
  if (scenarioHasFrameworks) {
    const noFrameworks =
      !state.framework_detections || state.framework_detections.length === 0;
    if (noFrameworks) return true;
  }
  return false;
}

function reconstructFromTurns(turns: Turn[]): {
  evidenceLogs: DecisionEvidenceLogEntry[];
  frameworkDetections: FrameworkDetection[][];
} {
  const sorted = [...turns].sort((a, b) => a.turnNumber - b.turnNumber);

  for (let i = sorted.length - 1; i >= 0; i--) {
    const ar = sorted[i].agentResponse as TurnResponse | undefined;
    const state = ar?.updatedState;
    if (
      state?.decisionEvidenceLogs &&
      state.decisionEvidenceLogs.length > 0
    ) {
      return {
        evidenceLogs: state.decisionEvidenceLogs,
        frameworkDetections: state.framework_detections || [],
      };
    }
  }

  const evidenceLogs: DecisionEvidenceLogEntry[] = [];
  const frameworkDetections: FrameworkDetection[][] = [];
  for (const turn of sorted) {
    const ar = turn.agentResponse as TurnResponse | undefined;
    const state = ar?.updatedState;
    const logs = state?.decisionEvidenceLogs || [];
    if (logs.length > 0) {
      evidenceLogs.push(logs[logs.length - 1]);
    }
    if (ar?.framework_detections && ar.framework_detections.length > 0) {
      frameworkDetections.push(ar.framework_detections);
    } else {
      const stateDetections = state?.framework_detections;
      if (stateDetections && stateDetections.length > 0) {
        frameworkDetections.push(stateDetections[stateDetections.length - 1]);
      } else {
        frameworkDetections.push([]);
      }
    }
  }
  return { evidenceLogs, frameworkDetections };
}

async function repairSession(
  session: SimulationSession & { scenario?: Scenario },
  dryRun: boolean,
): Promise<BackfillResult> {
  if (session.status !== "completed") {
    return { sessionId: session.id, status: "skipped_not_completed" };
  }

  const state = session.currentState;
  const scenario = session.scenario;
  const initial = scenario?.initialState;
  const frameworks = initial?.frameworks || [];
  const language = (scenario?.language as "es" | "en" | undefined) || "es";

  if (!needsRepair(state, frameworks.length > 0)) {
    return { sessionId: session.id, status: "skipped_already_populated" };
  }

  const turns = await storage.getTurnsBySession(session.id);
  if (turns.length === 0) {
    return { sessionId: session.id, status: "skipped_no_turns" };
  }

  const { evidenceLogs, frameworkDetections } = reconstructFromTurns(turns);
  if (evidenceLogs.length === 0) {
    return { sessionId: session.id, status: "skipped_no_evidence_in_turns" };
  }

  let dashboardSummary: SimulationState["dashboard_summary"] | undefined;
  try {
    const ctx: AgentContext = {
      sessionId: session.id,
      turnCount: state?.turnCount ?? evidenceLogs.length,
      currentKpis: state?.kpis ?? ({} as AgentContext["currentKpis"]),
      history: [],
      studentInput: "",
      language,
      scenario: {
        title: scenario?.title || "",
        domain: scenario?.domain || "",
        role: initial?.role || "",
        objective: initial?.objective || "",
        frameworks,
      },
    };

    if (dryRun) {
      return {
        sessionId: session.id,
        status: "would_repair",
        reconstructedTurnCount: evidenceLogs.length,
      };
    }

    dashboardSummary = await generateDashboardSummary(
      ctx,
      evidenceLogs,
      frameworkDetections,
      frameworks,
    );
  } catch (err) {
    if (dryRun) {
      return {
        sessionId: session.id,
        status: "would_repair",
        reconstructedTurnCount: evidenceLogs.length,
        message: `Summary generation would be attempted; preview failed: ${(err as Error).message}`,
      };
    }
    console.error(
      `[Backfill] Dashboard summary generation failed for ${session.id}:`,
      err,
    );
  }

  const updatedState: SimulationState = {
    ...(state as SimulationState),
    decisionEvidenceLogs:
      state?.decisionEvidenceLogs && state.decisionEvidenceLogs.length > 0
        ? state.decisionEvidenceLogs
        : evidenceLogs,
    framework_detections:
      state?.framework_detections && state.framework_detections.length > 0
        ? state.framework_detections
        : frameworkDetections,
    dashboard_summary: state?.dashboard_summary ?? dashboardSummary,
  };

  await storage.updateSimulationSession(session.id, {
    currentState: updatedState,
  });

  return {
    sessionId: session.id,
    status: dashboardSummary ? "repaired" : "repaired_logs_only",
    reconstructedTurnCount: evidenceLogs.length,
  };
}

export async function backfillSessionAnalytics(
  options: BackfillOptions = {},
): Promise<BackfillSummary> {
  const { sessionId, dryRun = false, scenarioId } = options;

  const sessionsToProcess: Array<SimulationSession & { scenario?: Scenario }> = [];

  if (sessionId) {
    const s = await storage.getSimulationSessionWithScenario(sessionId);
    if (s) sessionsToProcess.push(s);
  } else {
    const where = scenarioId
      ? and(
          eq(simulationSessions.status, "completed"),
          eq(simulationSessions.scenarioId, scenarioId),
        )
      : eq(simulationSessions.status, "completed");

    const rows = await db
      .select()
      .from(simulationSessions)
      .leftJoin(scenarios, eq(simulationSessions.scenarioId, scenarios.id))
      .where(where)
      .orderBy(desc(simulationSessions.updatedAt));

    for (const r of rows) {
      sessionsToProcess.push({
        ...r.simulation_sessions,
        scenario: r.scenarios || undefined,
      });
    }
  }

  const summary: BackfillSummary = {
    scanned: 0,
    repaired: 0,
    wouldRepair: 0,
    skipped: 0,
    errors: 0,
    results: [],
  };

  for (const session of sessionsToProcess) {
    summary.scanned++;
    try {
      const result = await repairSession(session, dryRun);
      summary.results.push(result);
      if (result.status === "repaired" || result.status === "repaired_logs_only") {
        summary.repaired++;
      } else if (result.status === "would_repair") {
        summary.wouldRepair++;
      } else {
        summary.skipped++;
      }
    } catch (err) {
      summary.errors++;
      summary.results.push({
        sessionId: session.id,
        status: "error",
        message: (err as Error).message,
      });
      console.error(
        `[Backfill] Failed to repair session ${session.id}:`,
        err,
      );
    }
  }

  return summary;
}
