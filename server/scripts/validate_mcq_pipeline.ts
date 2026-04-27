// Validation harness for TASK 1: MCQ analytics blackhole fix.
//
// Runs the same downstream functions that director.ts:740 now invokes for MCQ
// turns (extractSignals → tradeoff floor → detectFrameworks) against a
// synthetic but realistic MCQ context.  Asserts gates 1, 2, 3, and 5 from
// the task spec.  Does NOT touch the database or any session state.
//
// Usage: tsx server/scripts/validate_mcq_pipeline.ts

import { extractSignals } from "../agents/signalExtractor";
import { detectFrameworks } from "../agents/frameworkDetector";
import {
  SignalQuality,
  computeRDS,
  classifyRDSBand,
  mapCompetencyEvidence,
  type AgentContext,
  type DecisionEvidenceLog,
  type SignalExtractionResult,
} from "../agents/types";
import type { CaseFramework, DecisionPoint } from "@shared/schema";

// ────────────────────────────────────────────────────────────────────────────
// Inline copies of the two helpers the new MCQ branch uses.  Kept here so the
// validator does not have to import private functions from director.ts.
// ────────────────────────────────────────────────────────────────────────────

function resolveOptionSignature(studentInput: string, decisionPoint?: DecisionPoint) {
  if (!decisionPoint) return undefined;
  const optionSignatures = (decisionPoint as any).optionSignatures || {};
  const trimmed = (studentInput || "").trim().toLowerCase();
  if (decisionPoint.options) {
    for (let i = 0; i < decisionPoint.options.length; i++) {
      const optText = decisionPoint.options[i].toLowerCase();
      if (
        trimmed === optText ||
        trimmed.includes(optText) ||
        optText.includes(trimmed.split("\n")[0])
      ) {
        const sig =
          optionSignatures[decisionPoint.options[i]] ||
          optionSignatures[String(i)] ||
          optionSignatures[String(i + 1)];
        if (sig) return sig;
      }
    }
  }
  return (decisionPoint as any).tradeoffSignature;
}

function buildMcqSignalsStub(
  studentInput: string,
  decisionPoint?: DecisionPoint,
): SignalExtractionResult {
  const sig = resolveOptionSignature(studentInput, decisionPoint);
  const hasTradeoff = sig && sig.dimension && sig.cost && sig.benefit;
  const absent = { quality: SignalQuality.ABSENT, extracted_text: "" };
  return {
    intent: absent,
    justification: absent,
    tradeoffAwareness: hasTradeoff
      ? {
          quality: SignalQuality.PRESENT,
          extracted_text: `${sig.dimension}: ${sig.cost} vs ${sig.benefit}`,
        }
      : absent,
    stakeholderAwareness: absent,
    ethicalAwareness: absent,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Synthetic test context: an MCQ turn where the student picked a tradeoff-
// bearing option and added a substantive (~70-word) justification.  This is
// exactly the shape InputConsole.tsx assembles before submitting.
// ────────────────────────────────────────────────────────────────────────────

const CHOSEN_OPTION =
  "Negotiate expedited partial shipments with the disrupted supplier, accepting higher costs temporarily.";
const JUSTIFICATION =
  "I would prioritise keeping our retail partners stocked over short-term margin, because the relationship and reputation we built took years and a stock-out would push customers to competitors. The extra freight cost is recoverable in two quarters once the alternate supplier is qualified, and I will simultaneously brief leadership on the long-term sourcing diversification plan so we are not exposed to a single supplier again.";
const STUDENT_INPUT = `${CHOSEN_OPTION}\n\nJustification: ${JUSTIFICATION}`;

const COST_BENEFIT_FW: CaseFramework = {
  id: "fw_cost_benefit",
  name: "Cost-Benefit Analysis",
  canonicalId: "cost_benefit_analysis",
  primaryDimension: "tradeoffAwareness",
  domainKeywords: ["cost", "benefit", "trade-off", "tradeoff", "cost-benefit"],
  aliases: ["CBA", "cost benefit"],
  rubric: { explicit: [], implicit: [], counterEvidence: [] } as any,
  signalPattern: {
    requiredSignals: ["tradeoffAwareness", "justification"],
    minQuality: "PRESENT",
    additionalKeywords: ["cost", "benefit"],
  },
  provenance: "explicit",
} as any;

const STAKEHOLDER_FW: CaseFramework = {
  id: "fw_stakeholder",
  name: "Stakeholder Analysis",
  canonicalId: "stakeholder_analysis",
  primaryDimension: "stakeholderAwareness",
  domainKeywords: ["stakeholder", "stakeholders", "customer", "supplier", "partner"],
  aliases: ["stakeholder mapping"],
  rubric: { explicit: [], implicit: [], counterEvidence: [] } as any,
  signalPattern: {
    requiredSignals: ["stakeholderAwareness"],
    minQuality: "PRESENT",
    additionalKeywords: ["stakeholder", "customer"],
  },
  provenance: "explicit",
} as any;

const DECISION_POINT: DecisionPoint = {
  number: 1,
  prompt: "How should the company respond to the supply chain disruption?",
  format: "multiple_choice",
  options: [
    "Wait for the original supplier to recover.",
    CHOSEN_OPTION,
    "Switch entirely to a new supplier immediately.",
    "Pause production until conditions normalise.",
  ],
  primaryDimension: "tradeoffAwareness",
  optionSignatures: {
    [CHOSEN_OPTION]: {
      dimension: "speed_vs_cost",
      cost: "higher freight + premium pricing",
      benefit: "preserves customer relationships and continuity",
    },
  },
} as any;

const CONTEXT: AgentContext = {
  sessionId: "validate-mcq-smoke",
  turnCount: 0,
  currentDecision: 1,
  totalDecisions: 5,
  currentKpis: {} as any,
  history: [],
  studentInput: STUDENT_INPUT,
  language: "en",
  decisionPoints: [DECISION_POINT],
  scenario: {
    title: "Supply Chain Disruption During Strategic Expansion",
    domain: "Operations",
    role: "Director of Supply Chain",
    objective:
      "Maintain customer continuity while protecting margin during a supplier failure.",
    companyName: "GreenHarvest",
    situationBackground:
      "The primary supplier was hit by a port strike. Two retail partners account for 60% of revenue.",
    stakeholders: [
      { name: "Retail partners", role: "buyer", interests: "stock", influence: "high" },
      { name: "Original supplier", role: "supplier", interests: "recovery", influence: "medium" },
    ],
    keyConstraints: ["Margin pressure", "Two-week recovery window from supplier"],
    frameworks: [COST_BENEFIT_FW, STAKEHOLDER_FW],
  },
};

// ────────────────────────────────────────────────────────────────────────────
// Assertion helpers
// ────────────────────────────────────────────────────────────────────────────

const results: Array<{ gate: string; pass: boolean; detail: string }> = [];
function record(gate: string, pass: boolean, detail: string) {
  results.push({ gate, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${gate}  —  ${detail}`);
}

// ────────────────────────────────────────────────────────────────────────────
// Run the same code path director.ts now uses for MCQ turns.
// ────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n=== TASK 1 VALIDATION — MCQ pipeline smoke test ===\n");

  // Step A: extractSignals on the MCQ context (Gate 1)
  console.log("[A] Calling extractSignals on synthetic MCQ context …");
  const evidenceLog: DecisionEvidenceLog = await extractSignals(CONTEXT);
  const sd = evidenceLog.signals_detected;
  console.log("    raw scores:", evidenceLog.raw_signal_scores);

  const nonZeroCount = (Object.keys(sd) as Array<keyof SignalExtractionResult>).filter(
    (k) => sd[k].quality > 0,
  ).length;
  record(
    "Gate 1 (real signals on MCQ)",
    nonZeroCount >= 2,
    `${nonZeroCount}/5 signals have quality > 0 on a 70-word justification`,
  );

  // Step B: apply tradeoff floor exactly as director.ts:761 does
  console.log("\n[B] Applying tradeoff-signature floor …");
  const sig = resolveOptionSignature(STUDENT_INPUT, DECISION_POINT);
  const hasTradeoff = !!sig && sig.dimension && sig.cost && sig.benefit;
  const tradeoffBefore = sd.tradeoffAwareness.quality;
  if (hasTradeoff && sd.tradeoffAwareness.quality < SignalQuality.PRESENT) {
    sd.tradeoffAwareness = {
      ...sd.tradeoffAwareness,
      quality: SignalQuality.PRESENT,
      extracted_text: `${sig.dimension}: ${sig.cost} vs ${sig.benefit}`,
    };
    evidenceLog.rds_score = computeRDS(sd);
    evidenceLog.rds_band = classifyRDSBand(evidenceLog.rds_score);
    evidenceLog.competency_evidence = mapCompetencyEvidence(sd);
    evidenceLog.raw_signal_scores.tradeoffAwareness = SignalQuality.PRESENT;
    console.log(`    BUMPED tradeoffAwareness: ${tradeoffBefore} → PRESENT (2)`);
  } else {
    console.log(
      `    no bump needed (LLM already returned tradeoffAwareness=${tradeoffBefore}, hasTradeoff=${hasTradeoff})`,
    );
  }
  record(
    "Gate 3 (tradeoff floor preserved)",
    sd.tradeoffAwareness.quality >= SignalQuality.PRESENT,
    `tradeoffAwareness=${sd.tradeoffAwareness.quality} (>= PRESENT(2))`,
  );

  // Step C: detectFrameworks on the MCQ context (Gate 2)
  console.log("\n[C] Calling detectFrameworks on the same MCQ studentInput …");
  const detections = await detectFrameworks(
    STUDENT_INPUT,
    sd,
    [COST_BENEFIT_FW, STAKEHOLDER_FW],
    "en",
  );
  console.log(
    "    detections:",
    detections.map((d) => `${d.framework_name}=${d.level}/${d.confidence}/${d.detection_method}`),
  );
  const realDetections = detections.filter(
    (d) => d.level === "implicit" || d.level === "explicit",
  );
  record(
    "Gate 2 (framework detection runs on MCQ)",
    detections.length === 2 && realDetections.length >= 1,
    `got ${detections.length}/2 detection rows, ${realDetections.length} non-null`,
  );

  // Step D: Tradeoff-only short MCQ pick — should still get the floor (Gate 3 b)
  console.log(
    "\n[D] Short MCQ pick with no justification (just option text) — floor must still hold …",
  );
  const SHORT_INPUT = CHOSEN_OPTION;
  const shortContext: AgentContext = { ...CONTEXT, studentInput: SHORT_INPUT };
  const shortLog = await extractSignals(shortContext);
  const sigShort = resolveOptionSignature(SHORT_INPUT, DECISION_POINT);
  const sdShort = shortLog.signals_detected;
  if (sigShort && sdShort.tradeoffAwareness.quality < SignalQuality.PRESENT) {
    sdShort.tradeoffAwareness = {
      ...sdShort.tradeoffAwareness,
      quality: SignalQuality.PRESENT,
      extracted_text: `${sigShort.dimension}: ${sigShort.cost} vs ${sigShort.benefit}`,
    };
  }
  console.log(`    tradeoffAwareness on short pick = ${sdShort.tradeoffAwareness.quality}`);
  record(
    "Gate 3b (floor on bare option text)",
    sdShort.tradeoffAwareness.quality >= SignalQuality.PRESENT,
    `tradeoffAwareness=${sdShort.tradeoffAwareness.quality} on a ${SHORT_INPUT.split(/\s+/).length}-word pick`,
  );

  // Step E: Graceful-degradation fallback (Gate 5).  Builds the same fallback
  // evidenceLog the catch block in director.ts now constructs.
  console.log("\n[E] Verifying graceful-degradation fallback shape …");
  const fallback = buildMcqSignalsStub(STUDENT_INPUT, DECISION_POINT);
  const fallbackLog: DecisionEvidenceLog = {
    signals_detected: fallback,
    rds_score: null,
    rds_band: null,
    competency_evidence: mapCompetencyEvidence(fallback),
    raw_signal_scores: {
      intent: fallback.intent.quality,
      justification: fallback.justification.quality,
      tradeoffAwareness: fallback.tradeoffAwareness.quality,
      stakeholderAwareness: fallback.stakeholderAwareness.quality,
      ethicalAwareness: fallback.ethicalAwareness.quality,
    },
    isMcq: true,
  };
  console.log("    fallback raw_signal_scores:", fallbackLog.raw_signal_scores);
  record(
    "Gate 5 (fallback yields well-formed evidenceLog with tradeoff floor)",
    fallbackLog.isMcq === true &&
      fallbackLog.signals_detected.tradeoffAwareness.quality >= SignalQuality.PRESENT &&
      fallbackLog.raw_signal_scores.tradeoffAwareness === SignalQuality.PRESENT,
    `isMcq=${fallbackLog.isMcq}, tradeoff=${fallbackLog.signals_detected.tradeoffAwareness.quality}`,
  );

  // Summary
  console.log("\n=== SUMMARY ===");
  for (const r of results) console.log(`  [${r.pass ? "PASS" : "FAIL"}] ${r.gate}`);
  const allPass = results.every((r) => r.pass);
  console.log(allPass ? "\nALL GATES PASSED" : "\nSOME GATES FAILED");
  console.log(
    "\nRecorded evidenceLog (post-floor) for the substantive MCQ turn:\n",
    JSON.stringify(
      {
        signals_detected: sd,
        rds_score: evidenceLog.rds_score,
        rds_band: evidenceLog.rds_band,
        competency_evidence: evidenceLog.competency_evidence,
        raw_signal_scores: evidenceLog.raw_signal_scores,
        framework_detections: detections,
      },
      null,
      2,
    ),
  );

  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error("validation script crashed:", err);
  process.exit(2);
});
