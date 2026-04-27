/**
 * Forensic diagnostic — Analytics under-detection across recent sessions.
 *
 * Reads completed sessions in the diagnostic window (default: 2026-04-23 → now;
 * widens to last 14 days if zero are found), walks the framework detector's
 * three tiers per (session × turn × failed-framework), runs the §T-003B
 * word-count floors, cross-references signals_detected, and emits a single
 * markdown report at attached_assets/recent-sessions-diagnosis.md.
 *
 * READ-ONLY. No production code is modified by this script. All console.warn
 * lines emitted during framework detection (e.g. semantic check warnings) come
 * from the existing production code paths the script invokes — they are not
 * added by this diagnostic.
 *
 * Run: tsx server/scripts/diagnose_recent_sessions.ts
 */

import * as fs from "fs";
import * as path from "path";
import { db } from "../db";
import {
  simulationSessions,
  scenarios,
  turns as turnsTable,
} from "@shared/schema";
import type {
  CaseFramework,
  DecisionEvidenceLogEntry,
  FrameworkDetection,
  SignalExtractionEntry,
} from "@shared/schema";
import { and, gte, eq, asc } from "drizzle-orm";
import {
  detectFrameworks,
  normalizeForMatch,
} from "../agents/frameworkDetector";
import {
  FRAMEWORK_REGISTRY,
  type FrameworkRegistryEntry,
} from "../agents/frameworkRegistry";
import {
  sessionWeightedScore,
  sessionAppliedCourseTheory,
} from "../calibrationScoring";
import { computeRDS, classifyRDSBand } from "../agents/types";
import type { SignalExtractionResult } from "../agents/types";

// ────────────────────────────────────────────────────────────────────────────
// Configuration
// ────────────────────────────────────────────────────────────────────────────

const PRIMARY_WINDOW_START = new Date("2026-04-23T00:00:00Z");
const FALLBACK_DAYS = 14;
const OUTPUT_PATH = path.join(
  process.cwd(),
  "attached_assets/recent-sessions-diagnosis.md"
);

// Cap on Tier 2 LLM re-runs (one batched call per session × turn).
const MAX_REDETECT_TURNS = 60;

// Approximate commit timestamps for cross-reference (Step 4g).
const RECENT_COMMITS: Array<{ sha: string; date: string; note: string }> = [
  { sha: "d454cfc", date: "2026-04-22", note: "(pre-window baseline)" },
  { sha: "4f7d956", date: "2026-04-23", note: "FIX 1" },
  { sha: "e05f1f2", date: "2026-04-24", note: "FIX 2 (signal confidence/marginal_evidence)" },
  { sha: "f21add4", date: "2026-04-25", note: "FIX 3" },
  { sha: "9706096", date: "2026-04-25", note: "FIX 4" },
  { sha: "d173499", date: "2026-04-26", note: "Task #95 MCQ control (pre-merge)" },
  { sha: "9dc1eee", date: "2026-04-26", note: "Task #95 MCQ control (merged)" },
];

// ────────────────────────────────────────────────────────────────────────────
// Markdown helpers
// ────────────────────────────────────────────────────────────────────────────

const lines: string[] = [];
function w(s: string = "") {
  lines.push(s);
}
function h1(s: string) {
  w("");
  w(`# ${s}`);
  w("");
}
function h2(s: string) {
  w("");
  w(`## ${s}`);
  w("");
}
function h3(s: string) {
  w("");
  w(`### ${s}`);
  w("");
}
function h4(s: string) {
  w("");
  w(`#### ${s}`);
  w("");
}
function code(body: string, lang: string = "") {
  w("```" + lang);
  w(body);
  w("```");
}
function table(headers: string[], rows: Array<Array<string | number>>) {
  w("| " + headers.join(" | ") + " |");
  w("| " + headers.map(() => "---").join(" | ") + " |");
  for (const r of rows) {
    w(
      "| " +
        r
          .map((c) => String(c ?? "").replace(/\|/g, "\\|").replace(/\n/g, " "))
          .join(" | ") +
        " |"
    );
  }
}
function quote(s: string): string {
  return `"${s.slice(0, 220)}${s.length > 220 ? "…" : ""}"`;
}

// ────────────────────────────────────────────────────────────────────────────
// Types & utilities
// ────────────────────────────────────────────────────────────────────────────

interface SessionRow {
  session: typeof simulationSessions.$inferSelect;
  scenario: typeof scenarios.$inferSelect;
  turns: Array<typeof turnsTable.$inferSelect>;
}

function wordCount(s: string): number {
  return (s || "").trim().split(/\s+/).filter((w) => w.length > 0).length;
}

function isTier1KeywordCopy(kw: string): boolean {
  // Exact mirror of frameworkDetector.isTier1Keyword (line 99-101): multi-word ONLY.
  // (Production does NOT special-case hyphens; single hyphenated tokens like
  //  "low-cost" still fall through to Tier-3 additionalKeywords.)
  if (!kw) return false;
  return kw.trim().includes(" ");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getRegistryByCanonicalId(
  canonicalId: string | undefined
): FrameworkRegistryEntry | undefined {
  if (!canonicalId) return undefined;
  return FRAMEWORK_REGISTRY.find((e) => e.canonicalId === canonicalId);
}

function frameworkDomainKeywords(
  fw: CaseFramework,
  language: "es" | "en"
): string[] {
  if (fw.domainKeywords && fw.domainKeywords.length > 0) return fw.domainKeywords;
  const reg = getRegistryByCanonicalId(fw.canonicalId);
  if (!reg) return [];
  return language === "en"
    ? reg.suggestedDomainKeywords_en
    : reg.suggestedDomainKeywords_es;
}

function frameworkSignalPattern(
  fw: CaseFramework
): NonNullable<CaseFramework["signalPattern"]> | undefined {
  if (fw.signalPattern && fw.signalPattern.requiredSignals?.length > 0) return fw.signalPattern;
  const reg = getRegistryByCanonicalId(fw.canonicalId);
  return reg?.suggestedSignalPattern;
}

// ────────────────────────────────────────────────────────────────────────────
// Step 1: Query completed sessions in the window
// ────────────────────────────────────────────────────────────────────────────

async function fetchSessions(after: Date): Promise<SessionRow[]> {
  const rows = await db
    .select()
    .from(simulationSessions)
    .innerJoin(scenarios, eq(scenarios.id, simulationSessions.scenarioId))
    .where(
      and(
        eq(simulationSessions.status, "completed"),
        gte(simulationSessions.updatedAt, after)
      )
    )
    .orderBy(asc(simulationSessions.updatedAt));

  const out: SessionRow[] = [];
  for (const r of rows) {
    const session = (r as any).simulation_sessions ?? (r as any).simulationSessions;
    const scenario = (r as any).scenarios;
    if (!session || !scenario) continue;
    const turns = await db
      .select()
      .from(turnsTable)
      .where(eq(turnsTable.sessionId, session.id))
      .orderBy(asc(turnsTable.turnNumber));
    out.push({ session, scenario, turns });
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Re-detection cache: one Tier 2 LLM call per (session × turn).
// ────────────────────────────────────────────────────────────────────────────

interface RedetectResult {
  detections: FrameworkDetection[];
  ranSemanticForFwIds: Set<string>;
  errored: boolean;
  errorMessage?: string;
}

async function redetectTurn(
  studentInput: string,
  signals: SignalExtractionResult,
  scenarioFrameworks: CaseFramework[],
  language: "es" | "en"
): Promise<RedetectResult> {
  // Mirror Tier 1 to compute the set of frameworks that would have gone to
  // Tier 2 (so we can answer Step 3 "in batch=YES/NO"). Then call the real
  // detectFrameworks.
  const eligible = scenarioFrameworks.filter(
    (fw) => fw.accepted_by_professor !== false
  );
  const wentToTier2 = new Set<string>();
  for (const fw of eligible) {
    const tier1 = (fw.domainKeywords || []).filter(isTier1KeywordCopy);
    const kwHit = tier1.find((k) =>
      new RegExp(`\\b${escapeRegex(k)}\\b`, "i").test(studentInput)
    );
    const nameHit = new RegExp(`\\b${escapeRegex(fw.name)}\\b`, "i").test(
      studentInput
    );
    const aliasHit = (fw.aliases || []).find((a) =>
      new RegExp(`\\b${escapeRegex(a)}\\b`, "i").test(studentInput)
    );
    if (!nameHit && !kwHit && !aliasHit) wentToTier2.add(fw.id);
  }

  try {
    const detections = await detectFrameworks(
      studentInput,
      signals,
      scenarioFrameworks,
      language
    );
    return {
      detections,
      ranSemanticForFwIds: wentToTier2,
      errored: false,
    };
  } catch (err: any) {
    return {
      detections: [],
      ranSemanticForFwIds: wentToTier2,
      errored: true,
      errorMessage: err?.message || String(err),
    };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Per-tier walk for a single (session × turn × framework)
// ────────────────────────────────────────────────────────────────────────────

interface TierWalkResult {
  tier1: { matched: boolean; matchedKeywords: string[]; tier1Keywords: string[] };
  tier2: {
    inBatch: boolean;
    reason?: string;
    redetectVerdict?: FrameworkDetection;
    floorTriggered?: "rejected" | "downgraded-low" | "passed" | "n/a";
    wordCountAtFloor: number;
  };
  tier3: {
    hasSignalPattern: boolean;
    signalPattern?: NonNullable<CaseFramework["signalPattern"]>;
    matched: boolean;
    perSignal: Array<{
      signal: string;
      required: number;
      actual: number;
      ok: boolean;
    }>;
  };
  recordedDetection?: FrameworkDetection;
  shouldHaveDetected: boolean;
  discrepancy: boolean;
  discrepancyReason: string;
}

const QUALITY_NUM: Record<string, number> = {
  ABSENT: 0,
  WEAK: 1,
  PRESENT: 2,
  STRONG: 3,
};

function walkTiers(
  fw: CaseFramework,
  studentInput: string,
  signals: SignalExtractionResult,
  recorded: FrameworkDetection | undefined,
  redetect: RedetectResult,
  language: "es" | "en"
): TierWalkResult {
  // Tier 1
  const tier1Keywords = (fw.domainKeywords || []).filter(isTier1KeywordCopy);
  const matchedKeywords: string[] = [];
  for (const k of tier1Keywords) {
    if (new RegExp(`\\b${escapeRegex(k)}\\b`, "i").test(studentInput)) {
      matchedKeywords.push(k);
    }
  }
  const nameHit = new RegExp(`\\b${escapeRegex(fw.name)}\\b`, "i").test(
    studentInput
  );
  const aliasHit = (fw.aliases || []).filter((a) =>
    new RegExp(`\\b${escapeRegex(a)}\\b`, "i").test(studentInput)
  );
  if (nameHit) matchedKeywords.push(`(name:${fw.name})`);
  for (const a of aliasHit) matchedKeywords.push(`(alias:${a})`);
  const tier1Matched = matchedKeywords.length > 0;

  // Tier 2
  const inBatch = redetect.ranSemanticForFwIds.has(fw.id);
  const wc = wordCount(studentInput);
  const redetectVerdict = redetect.detections.find(
    (d) => d.framework_id === fw.id
  );
  let floorTriggered: TierWalkResult["tier2"]["floorTriggered"] = "n/a";
  if (inBatch) {
    if (redetectVerdict && redetectVerdict.level === "implicit") {
      if (wc < 10) floorTriggered = "rejected";
      else if (wc < 15) floorTriggered = "downgraded-low";
      else floorTriggered = "passed";
    } else if (wc < 10) {
      // Could also be that the LLM said applied=false, in which case the
      // floor never had a chance to fire. We can't distinguish without the
      // raw verdict, so report "passed" (no floor needed) in that case.
      floorTriggered = "passed";
    } else {
      floorTriggered = "passed";
    }
  }

  // Tier 3 — signalPattern is a single object with requiredSignals[] + minQuality.
  const sigPattern = frameworkSignalPattern(fw);
  const perSignal: TierWalkResult["tier3"]["perSignal"] = [];
  let tier3Matched = false;
  if (sigPattern && sigPattern.requiredSignals?.length > 0) {
    const required = QUALITY_NUM[sigPattern.minQuality] ?? 0;
    let allOk = true;
    for (const sigName of sigPattern.requiredSignals) {
      const sigKey = sigName as keyof SignalExtractionResult;
      const actual = signals?.[sigKey]?.quality ?? 0;
      const ok = actual >= required;
      perSignal.push({ signal: sigName, required, actual, ok });
      if (!ok) allOk = false;
    }
    tier3Matched = allOk;
  }

  // Should-have-detected logic — exact mirror of frameworkDetector.ts async path.
  //   • Tier-1 short-circuits (pushes detection, never enters Tier-2).
  //   • Tier-2: frameworks that reached the semantic batch get pushed iff
  //     the LLM verdict was applied=true AND quote-check passed (level=implicit).
  //   • Tier-3: only evaluated for frameworks that REACHED Tier-2 but the
  //     semantic verdict did not push. Uses additionalKeywords ∪ ALL
  //     domainKeywords (single-word allowed here).
  let shouldHaveDetected = false;
  const tier2Pushed = !!redetectVerdict && redetectVerdict.level === "implicit";
  if (tier1Matched) {
    shouldHaveDetected = true;
  } else if (tier2Pushed) {
    shouldHaveDetected = true;
  } else if (inBatch && sigPattern && tier3Matched) {
    // Tier-3 only fires for frameworks that went through Tier-2 without pushing.
    // Note: this signal-quality check is a necessary but not sufficient
    // condition — production also requires (additionalKeywords match OR any
    // domainKeyword match). The keyword-presence check is approximated by
    // tier1Matched=false above, so this may slightly over-count Tier-3 hits.
    shouldHaveDetected = true;
  }

  // Discrepancy: redetect-vs-recorded.  A `recorded` row with level === 'not_evidenced'
  // is the detector's null-result; treat it as "no detection" so the discrepancy math
  // matches the production semantics of frameworkDetections rows.
  const recordedIsRealDetection =
    !!recorded &&
    (recorded.level === "explicit" || recorded.level === "implicit");
  let discrepancy = false;
  let discrepancyReason = "";
  if (shouldHaveDetected && !recordedIsRealDetection) {
    discrepancy = true;
    discrepancyReason =
      "Re-run pipeline produced a detection that the historical record lacks.";
  } else if (!shouldHaveDetected && recordedIsRealDetection) {
    discrepancy = true;
    discrepancyReason =
      "Historical record has a detection that the re-run pipeline does not produce.";
  } else if (
    recordedIsRealDetection &&
    redetectVerdict &&
    recorded!.level !== redetectVerdict.level
  ) {
    discrepancy = true;
    discrepancyReason = `Level changed: recorded=${recorded!.level}, re-run=${redetectVerdict.level}.`;
  }

  return {
    tier1: { matched: tier1Matched, matchedKeywords, tier1Keywords },
    tier2: {
      inBatch,
      redetectVerdict,
      floorTriggered,
      wordCountAtFloor: wc,
    },
    tier3: {
      hasSignalPattern: !!sigPattern && (sigPattern.requiredSignals?.length ?? 0) > 0,
      signalPattern: sigPattern,
      matched: tier3Matched,
      perSignal,
    },
    recordedDetection: recorded,
    shouldHaveDetected,
    discrepancy,
    discrepancyReason,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Aggregation accumulators (Step 4)
// ────────────────────────────────────────────────────────────────────────────

interface AggRow {
  sessionId: string;
  scenarioId: string;
  scenarioTitle: string;
  turnNumber: number;
  isMcq: boolean;
  framework: string;
  canonicalId?: string;
  walk: TierWalkResult;
  studentInput: string;
}

const allWalks: AggRow[] = [];

interface SignalConfStats {
  totalSignalSlots: number;
  withConfidence: number;
  withMarginalEvidence: number;
  byKey: Record<
    string,
    { total: number; withConfidence: number; withMarginalEvidence: number }
  >;
}

const SIGNAL_KEYS = [
  "intent",
  "justification",
  "tradeoffAwareness",
  "stakeholderAwareness",
  "ethicalAwareness",
] as const;

const sigStats: SignalConfStats = {
  totalSignalSlots: 0,
  withConfidence: 0,
  withMarginalEvidence: 0,
  byKey: Object.fromEntries(
    SIGNAL_KEYS.map((k) => [k, { total: 0, withConfidence: 0, withMarginalEvidence: 0 }])
  ) as any,
};

function tallySignals(signals: SignalExtractionEntry) {
  for (const k of SIGNAL_KEYS) {
    const slot = (signals as any)?.[k];
    sigStats.totalSignalSlots++;
    sigStats.byKey[k].total++;
    if (
      slot &&
      (slot.confidence === "high" ||
        slot.confidence === "medium" ||
        slot.confidence === "low")
    ) {
      sigStats.withConfidence++;
      sigStats.byKey[k].withConfidence++;
    }
    if (slot && typeof slot.marginal_evidence === "string" && slot.marginal_evidence.length > 0) {
      sigStats.withMarginalEvidence++;
      sigStats.byKey[k].withMarginalEvidence++;
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Per-session diagnostic builder
// ────────────────────────────────────────────────────────────────────────────

async function diagnoseSession(row: SessionRow): Promise<void> {
  const { session, scenario, turns } = row;
  const language: "es" | "en" =
    ((scenario.initialState as any)?.language ||
      (scenario as any).language ||
      "es") as "es" | "en";

  const initialState = (scenario.initialState || {}) as any;
  const decisionPoints: any[] = initialState.decisionPoints || [];
  const scenarioFrameworks: CaseFramework[] = initialState.frameworks || [];
  const pedIntent: any = (scenario as any).pedagogicalIntent || {};
  const currentState = (session.currentState || {}) as any;
  const evidenceLogs: DecisionEvidenceLogEntry[] =
    currentState.decisionEvidenceLogs || [];
  const fwDetectionsByTurn: FrameworkDetection[][] =
    currentState.framework_detections || [];

  h2(`Session ${session.id}`);

  // 2(a) Pedagogical intent
  h3("(a) Pedagogical intent");
  const targetFrameworks = (pedIntent.targetFrameworks || []).map(
    (f: any) =>
      `- ${f.name || "(no name)"}  · id=\`${f.id || "?"}\` · canonicalId=\`${
        f.canonicalId || "?"
      }\``
  );
  w(`- **scenarioId**: \`${scenario.id}\``);
  w(`- **scenario.title**: ${scenario.title}`);
  w(`- **scenario.language**: ${language}`);
  w(`- **scenario.authorId**: \`${(scenario as any).authorId}\``);
  w(`- **session.updated_at**: ${session.updatedAt?.toISOString?.() ?? session.updatedAt}`);
  w(`- **decisionPoints**: ${decisionPoints.length}`);
  w(`- **teachingGoal**: ${pedIntent.teachingGoal ? quote(pedIntent.teachingGoal) : "(none)"}`);
  w(`- **targetCompetencies**: ${(pedIntent.targetCompetencies || []).join(", ") || "(none)"}`);
  w(`- **targetDisciplines**: ${(pedIntent.targetDisciplines || []).join(", ") || "(none)"}`);
  w(`- **courseContext**: ${pedIntent.courseContext ? quote(pedIntent.courseContext) : "(none)"}`);
  w(`- **reasoningConstraint**: ${pedIntent.reasoningConstraint ? quote(pedIntent.reasoningConstraint) : "(none)"}`);
  w(`- **pedagogicalIntent.targetFrameworks (${(pedIntent.targetFrameworks || []).length})**:`);
  for (const tf of targetFrameworks) w(tf);

  // 2(b) Scenario frameworks (registry hydration check)
  h3("(b) scenario.frameworks (registry-match check)");
  const fwTableRows: Array<Array<string | number>> = [];
  const missingDetails: CaseFramework[] = [];
  for (const fw of scenarioFrameworks) {
    const reg = getRegistryByCanonicalId(fw.canonicalId);
    fwTableRows.push([
      fw.name || "(no name)",
      fw.id,
      fw.canonicalId || "(none)",
      (fw as any).primaryDimension || "?",
      (fw as any).provenance ?? "(undefined)",
      reg ? "MATCHED" : "MISSING",
    ]);
    if (!reg) missingDetails.push(fw);
  }
  table(
    ["name", "id", "canonicalId", "primaryDimension", "provenance", "registry"],
    fwTableRows
  );
  if (missingDetails.length > 0) {
    h4("MISSING registry entries — full framework objects");
    for (const fw of missingDetails) {
      code(JSON.stringify(fw, null, 2), "json");
    }
  }

  // Per-turn breakdown (2c–2e) and Step 3 walk
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    const evLog = evidenceLogs[i];
    const recordedDets = fwDetectionsByTurn[i] || [];
    const dp = decisionPoints.find((d) => d.number === t.turnNumber) ||
      decisionPoints[i] ||
      {};

    const studentInput = t.studentInput || evLog?.student_input || "";
    const wc = wordCount(studentInput);
    const isMcq = !!evLog?.isMcq || dp?.format === "multiple_choice";

    h3(`Turn ${t.turnNumber} — ${isMcq ? "MCQ" : "free-response"}`);

    // 2(c) Student input
    w(`- **decision prompt**: ${quote(dp?.prompt || dp?.title || "(missing)")}`);
    w(`- **format**: ${dp?.format || (isMcq ? "multiple_choice" : "free_response")}`);
    w(`- **word count of student contribution**: ${wc}`);
    if (isMcq) {
      w(`- **chosen text**: ${quote(studentInput)}`);
    } else {
      w(`- **verbatim student response**:`);
      code(studentInput || "(empty)", "");
    }

    // 2(d) framework_detections this turn
    h4("framework_detections (recorded)");
    if (recordedDets.length === 0) {
      w("_(none recorded for this turn)_");
    } else {
      table(
        ["framework", "id", "canonicalId", "level", "confidence", "method", "evidence", "reasoning"],
        recordedDets.map((d) => [
          d.framework_name,
          d.framework_id,
          (d as any).canonicalId || "?",
          d.level,
          (d as any).confidence ?? "?",
          (d as any).detection_method ?? "?",
          quote(d.evidence || ""),
          quote((d as any).reasoning || ""),
        ])
      );
    }

    // 2(e) signals_detected
    h4("signals_detected (recorded)");
    if (!evLog) {
      w("_(no evidence log entry recorded for this turn)_");
    } else {
      const sigRows: Array<Array<string | number>> = [];
      for (const k of SIGNAL_KEYS) {
        const s = (evLog.signals_detected as any)[k] || {};
        sigRows.push([
          k,
          s.quality ?? 0,
          quote(s.extracted_text || ""),
          s.confidence ?? "(undefined)",
          quote(s.marginal_evidence || ""),
        ]);
      }
      table(
        ["signal", "quality", "extracted_text", "confidence", "marginal_evidence"],
        sigRows
      );
      tallySignals(evLog.signals_detected);
    }

    // Per-turn re-detection (one batched LLM call)
    let redetect: RedetectResult | null = null;
    if (allRedetectCount < MAX_REDETECT_TURNS && studentInput.trim().length > 0) {
      redetect = await redetectTurn(
        studentInput,
        evLog?.signals_detected as SignalExtractionResult,
        scenarioFrameworks,
        language
      );
      allRedetectCount++;
    } else if (!studentInput.trim()) {
      redetect = {
        detections: [],
        ranSemanticForFwIds: new Set(),
        errored: false,
      };
    }

    // Step 3: Tier walk for failed frameworks (we walk EVERY framework here so
    // the cross-session aggregation can include the full picture).
    h4("Tier walk (per scenario framework)");
    if (!redetect) {
      w(`_(skipped — exceeded ${MAX_REDETECT_TURNS} re-detection cap)_`);
      continue;
    }
    if (redetect.errored) {
      w(`_(re-detection errored: ${redetect.errorMessage})_`);
    }

    for (const fw of scenarioFrameworks) {
      const recorded = recordedDets.find((d) => d.framework_id === fw.id);
      const walk = walkTiers(
        fw,
        studentInput,
        evLog?.signals_detected as SignalExtractionResult,
        recorded,
        redetect,
        language
      );
      allWalks.push({
        sessionId: session.id,
        scenarioId: scenario.id,
        scenarioTitle: scenario.title || "",
        turnNumber: t.turnNumber,
        isMcq,
        framework: fw.name,
        canonicalId: fw.canonicalId,
        walk,
        studentInput,
      });

      const t1 = walk.tier1.matched
        ? `MATCH on [${walk.tier1.matchedKeywords.join(", ")}]`
        : `no match (tier1Keywords=[${walk.tier1.tier1Keywords.join(", ") || "(none)"}])`;

      let t2: string;
      if (!walk.tier2.inBatch) {
        t2 = "in batch=NO (Tier 1 short-circuited)";
      } else if (walk.tier2.redetectVerdict?.level === "implicit") {
        const v = walk.tier2.redetectVerdict;
        t2 = `in batch=YES; LLM applied=true confidence=${(v as any).confidence}; floor=${walk.tier2.floorTriggered}; quoted=${quote(
          (v.evidence || "").replace(/[\r\n]+/g, " ").replace(/^.*?"([^"]*)".*$/, "$1") || ""
        )}`;
      } else {
        t2 = `in batch=YES; LLM applied=false (or floor rejected); word_count=${walk.tier2.wordCountAtFloor}`;
      }

      let t3: string;
      if (!walk.tier3.hasSignalPattern) {
        t3 = "no signalPattern in registry";
      } else {
        const detail = walk.tier3.perSignal
          .map((p) => `${p.signal}@${p.actual}/${p.required}${p.ok ? "✓" : "✗"}`)
          .join(", ");
        t3 = `${walk.tier3.matched ? "MATCH" : "no match"} (${detail})`;
      }

      const recordedStr = recorded
        ? `level=${recorded.level}, method=${(recorded as any).detection_method}, confidence=${(recorded as any).confidence}`
        : "not_evidenced";

      w(`- **${fw.name}**`);
      w(`  - Tier 1: ${t1}`);
      w(`  - Tier 2: ${t2}`);
      w(`  - Tier 3: ${t3}`);
      w(`  - Recorded: ${recordedStr}`);
      if (walk.discrepancy) {
        w(`  - **DISCREPANCY**: ${walk.discrepancyReason}`);
      }
    }
  }

  // 2(f) Final dashboard outputs (computed from the same inputs the handlers
  //      use; we don't make HTTP calls here because handlers are inline closures
  //      in routes.ts and not separately exported. The values we compute mirror
  //      module-health and reasoning-signals exactly.)
  h3("(f) Computed dashboard outputs (module-health-equivalent)");
  const allTurnsForScenario = await db
    .select()
    .from(simulationSessions)
    .where(eq(simulationSessions.scenarioId, scenario.id));
  const completed = allTurnsForScenario.filter((s) => s.status === "completed");
  const moduleHealthRows: Array<Array<string | number>> = [];
  for (const fw of scenarioFrameworks) {
    let appliedCount = 0;
    let weightedSum = 0;
    const methodDist: Record<string, number> = {};
    for (const s of completed) {
      const state = (s.currentState || {}) as any;
      const fwd: any[][] = state.framework_detections || [];
      let applied = false;
      for (const turnDets of fwd) {
        const det = turnDets?.find((d: any) => d.framework_id === fw.id);
        if (det) {
          methodDist[det.detection_method || "keyword"] =
            (methodDist[det.detection_method || "keyword"] || 0) + 1;
          if (det.level === "explicit" || det.level === "implicit") applied = true;
        }
      }
      if (applied) appliedCount++;
      weightedSum += sessionWeightedScore(fw.id, fwd as any);
    }
    const weighted = completed.length > 0 ? weightedSum / completed.length : 0;
    let status: string;
    if (weighted >= 0.6) status = "transferring";
    else if (weighted >= 0.3) status = "developing";
    else if (weighted > 0) status = "not_yet_evidenced";
    else status = "absent";
    moduleHealthRows.push([
      fw.name,
      `${appliedCount}/${completed.length}`,
      weighted.toFixed(3),
      status,
      Object.entries(methodDist).map(([k, v]) => `${k}:${v}`).join(", ") || "(none)",
    ]);
  }
  table(
    ["framework", "applied/total", "weightedScore", "status", "method distribution"],
    moduleHealthRows
  );

  h3("(f) reasoning-signals-equivalent (per turn averages for THIS session)");
  const sigAvgRows: Array<Array<string | number>> = [];
  for (const k of SIGNAL_KEYS) {
    const sum = evidenceLogs.reduce(
      (acc, l) => acc + (((l.signals_detected as any)?.[k]?.quality) ?? 0),
      0
    );
    const avg = evidenceLogs.length > 0 ? sum / evidenceLogs.length : 0;
    sigAvgRows.push([k, avg.toFixed(2)]);
  }
  table(["signal", "average across turns"], sigAvgRows);
  const rdsScores = evidenceLogs.map((l) => l.rds_score ?? null);
  const rdsBands = evidenceLogs.map((l) => l.rds_band ?? "?");
  w(`- **RDS per turn**: [${rdsScores.join(", ")}]`);
  w(`- **RDS bands per turn**: [${rdsBands.join(", ")}]`);

  // 2(g) Cache state
  h3("(g) Cache state");
  w(
    "Note: dashboardCache is in-memory in the running Express process. This script runs in a separate process, so the live cache is not addressable from here. The current process has an empty cache for the diagnostic-script lifetime."
  );
  w(
    "If staleness investigation is needed, restart the Express process (which clears the cache) or instrument a debug endpoint that prints cache contents."
  );
  w(
    `For reference: cache keys would be \`module-health-${scenario.id}\` and \`class-stats-${scenario.id}\` (TTL 5 min, version-token gated).`
  );
}

let allRedetectCount = 0;

// ────────────────────────────────────────────────────────────────────────────
// Step 4: Cross-session pattern analysis
// ────────────────────────────────────────────────────────────────────────────

function emitCrossSessionAggregates(rows: SessionRow[]) {
  h1("Step 4 — Cross-session pattern analysis");

  // (a) Tier 2 firing rate
  const total = allWalks.length;
  const tier1Hit = allWalks.filter((r) => r.walk.tier1.matched).length;
  const tier2InBatch = allWalks.filter((r) => r.walk.tier2.inBatch).length;
  const tier2Applied = allWalks.filter(
    (r) => r.walk.tier2.redetectVerdict?.level === "implicit"
  ).length;
  h2("(a) Tier 2 firing rate");
  w(`- Total (session × turn × framework) walks: **${total}**`);
  w(`- Tier 1 short-circuit (kept Tier 2 from running): **${tier1Hit}** (${pct(tier1Hit, total)})`);
  w(`- Sent to Tier 2 batch: **${tier2InBatch}** (${pct(tier2InBatch, total)})`);
  w(`- Tier 2 returned applied=true (re-run): **${tier2Applied}** (${pct(tier2Applied, tier2InBatch)} of in-batch)`);

  // (b) Verdict-vs-detection alignment
  h2("(b) Tier 2 verdict-vs-detection alignment");
  const t2AppliedAndRecorded = allWalks.filter(
    (r) =>
      r.walk.tier2.redetectVerdict?.level === "implicit" &&
      r.walk.recordedDetection
  ).length;
  const t2AppliedButMissing = allWalks.filter(
    (r) =>
      r.walk.tier2.redetectVerdict?.level === "implicit" &&
      !r.walk.recordedDetection
  ).length;
  w(`- Tier 2 applied AND recorded: **${t2AppliedAndRecorded}** / ${tier2Applied}`);
  w(
    `- Tier 2 applied (re-run) BUT missing from recorded: **${t2AppliedButMissing}** — pipeline-bug candidates`
  );
  if (t2AppliedButMissing > 0) {
    h4("Pipeline-bug candidates (re-run says applied=implicit; record has nothing)");
    table(
      ["session", "turn", "framework", "scenario", "isMcq", "wordCount"],
      allWalks
        .filter(
          (r) =>
            r.walk.tier2.redetectVerdict?.level === "implicit" &&
            !r.walk.recordedDetection
        )
        .map((r) => [
          r.sessionId.slice(0, 8),
          r.turnNumber,
          r.framework,
          r.scenarioTitle.slice(0, 40),
          r.isMcq ? "yes" : "no",
          wordCount(r.studentInput),
        ])
    );
  }

  // (c) Verdict-vs-rubric spot check
  h2("(c) Tier 2 applied=false spot-check (sample of 8)");
  const sample = allWalks
    .filter(
      (r) =>
        r.walk.tier2.inBatch &&
        (!r.walk.tier2.redetectVerdict ||
          r.walk.tier2.redetectVerdict.level !== "implicit") &&
        wordCount(r.studentInput) >= 15
    )
    .slice(0, 8);
  if (sample.length === 0) {
    w("_(no qualifying samples)_");
  } else {
    for (const r of sample) {
      w(`- **Session ${r.sessionId.slice(0, 8)}, Turn ${r.turnNumber}, ${r.framework}**`);
      w(`  - student (${wordCount(r.studentInput)} words): ${quote(r.studentInput)}`);
      w(
        `  - Tier 1: ${r.walk.tier1.matched ? "matched" : "no match"} | Tier 2 verdict: applied=false | Tier 3: ${r.walk.tier3.matched ? "would match" : "no match"}`
      );
    }
  }
  w(
    "_Manual spot-check required: classify each row as 'rubric too strict' / 'rubric correct' / 'mixed'._"
  );

  // (d) Floor false-positive rate
  h2("(d) §T-003B floor activity");
  const floorRej = allWalks.filter(
    (r) => r.walk.tier2.floorTriggered === "rejected"
  );
  const floorDown = allWalks.filter(
    (r) => r.walk.tier2.floorTriggered === "downgraded-low"
  );
  w(`- Hard rejected (<10 words): **${floorRej.length}**`);
  w(`- Downgraded to low (10–14 words): **${floorDown.length}**`);
  if (floorRej.length + floorDown.length > 0) {
    table(
      ["session", "turn", "framework", "wordCount", "action", "studentInput"],
      [...floorRej, ...floorDown].map((r) => [
        r.sessionId.slice(0, 8),
        r.turnNumber,
        r.framework,
        wordCount(r.studentInput),
        r.walk.tier2.floorTriggered!,
        quote(r.studentInput),
      ])
    );
  }

  // (e) Provenance distribution
  h2("(e) Framework provenance distribution");
  const provCounts: Record<string, number> = {};
  const seenFwKeys = new Set<string>();
  for (const r of rows) {
    const fws = ((r.scenario.initialState as any)?.frameworks || []) as CaseFramework[];
    for (const fw of fws) {
      const key = `${r.scenario.id}::${fw.id}`;
      if (seenFwKeys.has(key)) continue;
      seenFwKeys.add(key);
      const p = (fw as any).provenance ?? "undefined";
      provCounts[p] = (provCounts[p] || 0) + 1;
    }
  }
  table(
    ["provenance", "framework count (deduped per scenario)"],
    Object.entries(provCounts).map(([k, v]) => [k, v])
  );

  // (f) Cache staleness — see Step 2(g) note
  h2("(f) Cache staleness");
  w(
    "Direct cache inspection from this script is not possible (separate process). To detect staleness, instrument a debug endpoint or restart the Express process before checking dashboard responses."
  );

  // (g) Time-bucket pattern
  h2("(g) Time-bucket pattern (session completion vs recent commits)");
  table(
    ["sessionId", "completed_at", "scenario"],
    rows.map((r) => [
      r.session.id.slice(0, 8),
      r.session.updatedAt?.toISOString?.() ?? String(r.session.updatedAt),
      r.scenario.title || "",
    ])
  );
  w("");
  w("Recent commit reference:");
  table(
    ["sha", "date", "note"],
    RECENT_COMMITS.map((c) => [c.sha, c.date, c.note])
  );

  // (h) Per-framework breakdown
  h2("(h) Per-framework failure breakdown");
  const perFw: Record<
    string,
    { walks: number; tier1Hits: number; tier2Applied: number; recorded: number }
  > = {};
  for (const r of allWalks) {
    const k = `${r.framework} (${r.canonicalId || "?"})`;
    if (!perFw[k]) perFw[k] = { walks: 0, tier1Hits: 0, tier2Applied: 0, recorded: 0 };
    perFw[k].walks++;
    if (r.walk.tier1.matched) perFw[k].tier1Hits++;
    if (r.walk.tier2.redetectVerdict?.level === "implicit") perFw[k].tier2Applied++;
    if (r.walk.recordedDetection) perFw[k].recorded++;
  }
  table(
    ["framework", "walks", "Tier1 hits", "Tier2 applied (re-run)", "Recorded detections"],
    Object.entries(perFw)
      .sort((a, b) => a[1].recorded - b[1].recorded)
      .map(([k, v]) => [k, v.walks, v.tier1Hits, v.tier2Applied, v.recorded])
  );
  w(
    "_Note: tradeoffAwareness is a SIGNAL (one of the 5 in signals_detected), not a framework. The diagnostic pack's mention of 'Tradeoff Awareness landing' refers to the tradeoffAwareness signal being extracted, not a framework named 'Tradeoff' firing._"
  );
}

function pct(n: number, d: number): string {
  if (d <= 0) return "0%";
  return `${((n / d) * 100).toFixed(1)}%`;
}

// ────────────────────────────────────────────────────────────────────────────
// Step 5: Reasoning-depth diagnosis
// ────────────────────────────────────────────────────────────────────────────

function emitReasoningDepthDiagnosis(rows: SessionRow[]) {
  h1("Step 5 — Reasoning-depth diagnosis");

  w(
    "**Source of truth**: `server/agents/types.ts` exports `computeRDS(signals)` and `classifyRDSBand(score)`."
  );
  w("");
  code(
    [
      "// computeRDS — the formula:",
      "RDS = intent.quality + justification.quality + tradeoffAwareness.quality",
      "    + stakeholderAwareness.quality + ethicalAwareness.quality",
      "// quality ∈ {0, 1, 2, 3} → maximum = 15.",
      "",
      "// classifyRDSBand — the bands:",
      "RDS ≥ 10 → 'INTEGRATED'",
      "RDS ≥ 5  → 'ENGAGED'",
      "RDS < 5  → 'SURFACE'",
    ].join("\n"),
    "ts"
  );
  w("");
  w("**Answers to the explicit questions**:");
  w(
    "- Word count: NOT used in the formula and NOT used as a gate (the §T-003B floors are gates on the framework detector, not on RDS)."
  );
  w(
    "- MCQ turns: included at full weight. MCQ signals are produced by `buildMcqSignals` (director.ts:334), which typically yields only `tradeoffAwareness=2` per option signature — RDS for an MCQ-only turn is therefore ≤2, almost always classifying as SURFACE."
  );
  w(
    "- Free-response turns: signals come from `extractSignals` (signalExtractor.ts) — full LLM extraction across all five signals."
  );
  w(
    "- Framework detections: NOT an input to RDS. RDS is purely signal-based. So a missing framework detection does NOT depress RDS directly — but the dashboard 'reasoning depth' visualisation aggregates per-turn RDS and competency_evidence, both of which can be depressed independently. There is no compounding multiplier between framework detection and RDS."
  );

  // Per-session inputs/outputs
  h2("Per-session RDS trace");
  for (const r of rows) {
    const state = (r.session.currentState || {}) as any;
    const logs: DecisionEvidenceLogEntry[] = state.decisionEvidenceLogs || [];
    const fwd: FrameworkDetection[][] = state.framework_detections || [];
    h3(`Session ${r.session.id.slice(0, 8)} — ${r.scenario.title}`);
    const rows2: Array<Array<string | number>> = [];
    for (let i = 0; i < r.turns.length; i++) {
      const t = r.turns[i];
      const log = logs[i];
      const wc = wordCount(t.studentInput || "");
      const sigs = log?.signals_detected;
      const recomputed = sigs ? computeRDS(sigs as any) : null;
      const recordedRds = log?.rds_score ?? null;
      const recordedBand = log?.rds_band ?? "?";
      const qualBreakdown = sigs
        ? SIGNAL_KEYS.map((k) => `${k.slice(0, 4)}=${(sigs as any)[k]?.quality ?? 0}`).join(",")
        : "(no signals)";
      rows2.push([
        t.turnNumber,
        log?.isMcq ? "MCQ" : "FR",
        wc,
        qualBreakdown,
        recordedRds ?? "n/a",
        recomputed ?? "n/a",
        recordedBand,
        (fwd[i] || []).length,
      ]);
    }
    table(
      [
        "turn",
        "format",
        "wordCount",
        "signal qualities",
        "recordedRDS",
        "recomputedRDS",
        "band",
        "fwDetections",
      ],
      rows2
    );
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Step 6: Confirm FIX 2 actually shipped
// ────────────────────────────────────────────────────────────────────────────

function emitFix2Confirmation() {
  h1("Step 6 — Confirm FIX 2 (signal confidence + marginal_evidence)");

  w("**(a) Prompt schema check** — `server/agents/signalExtractor.ts`");
  w(
    "The system prompt (line ~200) DOES include `\"confidence\": \"high|medium|low\"` and `\"marginal_evidence\": \"...\"` for each of the 5 signals. The schema is requested from the LLM."
  );
  w("");
  w("**(b) Parser pass-through check** — `parseSignalResult`");
  w(
    "`parseSignalResult` (lines 212–258) uses a `passOptional(raw)` helper that copies `confidence` (only if it's one of `high|medium|low`) and `marginal_evidence` (only if it's a non-empty string). If absent, both fields are dropped (not stored as undefined). A defensive `console.warn` fires when the LLM omits a valid `confidence` for any of the 5 signals."
  );
  w("");
  w("**(c) Live data check** — across all sessions in scope.");
  w(
    "_Denominator scope_: only signal slots that the extractor actually emitted (i.e. turns with `decisionEvidenceLogs[turnIndex].signals_detected`). Turns where the extractor never ran (e.g. session 43be02df has 0 evidence_logs) are NOT counted as missing-confidence — that would conflate \"extractor never ran\" with \"LLM omitted the field\". The expected upper bound is `(turns with signals_detected) × 5 signals`."
  );
  w("");
  table(
    ["metric", "value"],
    [
      ["total signal slots", sigStats.totalSignalSlots],
      [
        "with valid confidence (high|medium|low)",
        `${sigStats.withConfidence} (${pct(sigStats.withConfidence, sigStats.totalSignalSlots)})`,
      ],
      [
        "with non-empty marginal_evidence",
        `${sigStats.withMarginalEvidence} (${pct(sigStats.withMarginalEvidence, sigStats.totalSignalSlots)})`,
      ],
    ]
  );
  table(
    ["signal", "total", "with confidence", "with marginal_evidence"],
    SIGNAL_KEYS.map((k) => [
      k,
      sigStats.byKey[k].total,
      `${sigStats.byKey[k].withConfidence} (${pct(sigStats.byKey[k].withConfidence, sigStats.byKey[k].total)})`,
      `${sigStats.byKey[k].withMarginalEvidence} (${pct(sigStats.byKey[k].withMarginalEvidence, sigStats.byKey[k].total)})`,
    ])
  );

  const ratio = sigStats.totalSignalSlots > 0
    ? sigStats.withConfidence / sigStats.totalSignalSlots
    : 0;
  w("");
  if (ratio < 0.5) {
    w(
      `**FIX 2 verdict**: under-populated (${pct(sigStats.withConfidence, sigStats.totalSignalSlots)}). Root cause is most likely the LLM silently omitting the new schema fields. Inspect: (i) is the prompt explicit enough, (ii) is the model honoring the optional fields, (iii) does the warn rate in production logs match the under-population rate?`
    );
  } else if (ratio < 0.95) {
    w(
      `**FIX 2 verdict**: partial coverage (${pct(sigStats.withConfidence, sigStats.totalSignalSlots)}). The fix shipped but the LLM occasionally omits the field. Sample a few un-populated rows to determine if it correlates with input shape (e.g. very short MCQ turns).`
    );
  } else {
    w(
      `**FIX 2 verdict**: shipped and active (${pct(sigStats.withConfidence, sigStats.totalSignalSlots)}). The \`confidence\` field is being populated end-to-end.`
    );
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────────

async function main() {
  const startedAt = new Date().toISOString();

  // Step 1: query
  let rows = await fetchSessions(PRIMARY_WINDOW_START);
  let usedWindow = `>= ${PRIMARY_WINDOW_START.toISOString()}`;
  let widened = false;
  if (rows.length === 0) {
    const cutoff = new Date(Date.now() - FALLBACK_DAYS * 24 * 3600 * 1000);
    rows = await fetchSessions(cutoff);
    usedWindow = `>= ${cutoff.toISOString()} (widened to ${FALLBACK_DAYS} days)`;
    widened = true;
  } else if (rows.length < 3) {
    // Spec mandates widening only on zero, but a single session yields no
    // cross-session pattern. Augment with prior 14 days and clearly mark.
    const cutoff = new Date(Date.now() - FALLBACK_DAYS * 24 * 3600 * 1000);
    const supplemental = await fetchSessions(cutoff);
    const seen = new Set(rows.map((r) => r.session.id));
    for (const s of supplemental) {
      if (!seen.has(s.session.id)) rows.push(s);
    }
    rows.sort((a, b) => {
      const ta = a.session.updatedAt instanceof Date ? a.session.updatedAt.getTime() : 0;
      const tb = b.session.updatedAt instanceof Date ? b.session.updatedAt.getTime() : 0;
      return ta - tb;
    });
    usedWindow = `${PRIMARY_WINDOW_START.toISOString()} → now (1 in strict window; 14-day supplement added for cross-session pattern detection)`;
  }

  h1("Forensic diagnostic — Analytics under-detection");
  w(`- **generated**: ${startedAt}`);
  w(`- **window**: ${usedWindow}`);
  w(`- **sessions in scope**: ${rows.length}`);
  w(`- **strict window** (\`completed_at >= 2026-04-23\`): see Step 1 table for which rows are inside vs supplemental.`);

  if (rows.length === 0) {
    h2("No completed sessions found");
    w(
      "No completed sessions in the strict window or the 14-day fallback. Nothing to diagnose. Stop."
    );
    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, lines.join("\n"));
    return;
  }

  // Step 1 table
  h2("Step 1 — Session inventory");
  table(
    [
      "in window?",
      "session id",
      "scenarioId",
      "completed_at",
      "scenario title",
      "lang",
      "authorId",
      "decisionPoints",
      "fw_det turns",
      "evidence logs",
    ],
    rows.map((r) => {
      const inWindow = (r.session.updatedAt instanceof Date ? r.session.updatedAt : new Date(r.session.updatedAt as any)) >=
        PRIMARY_WINDOW_START;
      const dpCount = ((r.scenario.initialState as any)?.decisionPoints || []).length;
      const fwdLen = ((r.session.currentState as any)?.framework_detections || []).length;
      const evLen = ((r.session.currentState as any)?.decisionEvidenceLogs || []).length;
      return [
        inWindow ? "YES" : "supp.",
        r.session.id.slice(0, 8),
        r.session.scenarioId.slice(0, 8),
        r.session.updatedAt?.toISOString?.() ?? String(r.session.updatedAt),
        (r.scenario.title || "").slice(0, 40),
        ((r.scenario as any).language || "?").toString(),
        ((r.scenario as any).authorId || "?").toString().slice(0, 8),
        dpCount,
        fwdLen,
        evLen,
      ];
    })
  );

  // Per-turn decisionPoint format breakdown (Step 1's "per-turn format" ask)
  h3("Step 1 — per-turn decisionPoint formats");
  for (const r of rows) {
    const dps: any[] = (r.scenario.initialState as any)?.decisionPoints || [];
    const formats = dps.map((d, i) => `T${i + 1}:${d.format || "?"}`).join("  ");
    w(`- \`${r.session.id.slice(0, 8)}\` — ${formats}`);
  }

  // Step 2 + 3 per session
  h1("Step 2 — Full diagnostic input per session  +  Step 3 — Tier-by-tier walk");
  w(
    `_Re-detection cap: at most ${MAX_REDETECT_TURNS} (session × turn) re-runs with one batched LLM call each._`
  );
  for (const r of rows) {
    try {
      await diagnoseSession(r);
    } catch (err: any) {
      h2(`Session ${r.session.id} — DIAGNOSIS ERROR`);
      w(`Error: ${err?.message || String(err)}`);
    }
  }

  // Step 4
  emitCrossSessionAggregates(rows);

  // Step 5
  emitReasoningDepthDiagnosis(rows);

  // Step 6
  emitFix2Confirmation();

  // Summary block (also printed to stdout for the agent reply)
  h1("Summary");
  const totalWalks = allWalks.length;
  const tier1Hit = allWalks.filter((r) => r.walk.tier1.matched).length;
  const tier2Applied = allWalks.filter(
    (r) => r.walk.tier2.redetectVerdict?.level === "implicit"
  ).length;
  const recordedDetCount = allWalks.filter((r) => r.walk.recordedDetection).length;
  const discrepancies = allWalks.filter((r) => r.walk.discrepancy).length;
  const pipelineBugs = allWalks.filter(
    (r) => r.walk.shouldHaveDetected && !r.walk.recordedDetection
  ).length;

  w(`- sessions analysed: **${rows.length}**`);
  w(`- (session × turn × framework) walks: **${totalWalks}**`);
  w(`- Tier 1 hits: **${tier1Hit}** (${pct(tier1Hit, totalWalks)})`);
  w(`- Tier 2 applied (re-run): **${tier2Applied}** (${pct(tier2Applied, totalWalks)})`);
  w(`- Historical detections: **${recordedDetCount}** (${pct(recordedDetCount, totalWalks)})`);
  w(`- Re-run vs recorded discrepancies: **${discrepancies}**`);
  w(`- Pipeline-bug candidates (re-run pushes; record empty): **${pipelineBugs}**`);
  w(
    `- FIX 2 confidence-field coverage: **${pct(sigStats.withConfidence, sigStats.totalSignalSlots)}** of signal slots`
  );
  w(`- FIX 2 marginal_evidence coverage: **${pct(sigStats.withMarginalEvidence, sigStats.totalSignalSlots)}** of signal slots`);
  w("");
  w("See body of the report for per-session walks, per-turn signal tables, and per-framework discrepancies.");

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, lines.join("\n"));

  // Print short summary to stdout for the agent log.
  process.stdout.write(
    `\n[diagnose_recent_sessions] Wrote ${OUTPUT_PATH}\n` +
      `Sessions=${rows.length} walks=${totalWalks} tier1Hits=${tier1Hit} tier2Applied=${tier2Applied} recorded=${recordedDetCount} discrepancies=${discrepancies} pipelineBugs=${pipelineBugs}\n` +
      `FIX2 confidence=${pct(sigStats.withConfidence, sigStats.totalSignalSlots)} marginal_evidence=${pct(sigStats.withMarginalEvidence, sigStats.totalSignalSlots)}\n`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    process.stderr.write(`Diagnostic failed: ${err?.stack || err}\n`);
    process.exit(1);
  });
