// Validation harness for TASK 2: confidence + marginal_evidence coverage.
//
// Runs extractSignals 5 times on a varied mix of inputs (free-response + MCQ,
// EN + ES, short + long) and computes the % of signal slots that carry both
// confidence and (where quality > 0) marginal_evidence.  Gate target: ≥95%.
//
// Usage: tsx server/scripts/validate_signal_coverage.ts

import { extractSignals } from "../agents/signalExtractor";
import { SignalQuality, type AgentContext, type SignalExtractionResult } from "../agents/types";

const SIGNAL_KEYS: Array<keyof SignalExtractionResult> = [
  "intent",
  "justification",
  "tradeoffAwareness",
  "stakeholderAwareness",
  "ethicalAwareness",
];

interface Sample {
  label: string;
  language: "en" | "es";
  studentInput: string;
  scenario: AgentContext["scenario"];
  decisionPoints?: AgentContext["decisionPoints"];
}

const SAMPLES: Sample[] = [
  {
    label: "1. EN free-response — long substantive",
    language: "en",
    studentInput:
      "I would prioritize a 90-day customer-retention sprint over the planned price increase. Our top-20 accounts represent 62% of revenue and three of them are already exploring alternatives, so losing even one of them would erase the projected uplift from the price hike. The cost of the sprint is roughly two months of marketing spend that we'd otherwise allocate to acquisition, and it requires Sales and CS to coordinate on a joint playbook. The benefit is preserved cash flow and a stronger negotiating position when we revisit pricing in Q3.",
    scenario: {
      title: "Pricing strategy under churn pressure",
      domain: "Strategy",
      role: "VP Strategy",
      objective: "Decide whether to raise prices or invest in retention.",
      stakeholders: [
        { name: "Top-20 accounts", role: "customer", interests: "stability", influence: "high" },
        { name: "Sales team", role: "internal", interests: "quota", influence: "medium" },
      ],
    },
  },
  {
    label: "2. EN free-response — short hedged",
    language: "en",
    studentInput: "Maybe we could try option B and see what happens.",
    scenario: {
      title: "Pricing strategy under churn pressure",
      domain: "Strategy",
      role: "VP Strategy",
      objective: "Decide whether to raise prices or invest in retention.",
    },
  },
  {
    label: "3. ES free-response — long substantive",
    language: "es",
    studentInput:
      "Recomendaría priorizar la diversificación de proveedores en los próximos dos trimestres porque la dependencia actual del proveedor único nos expone a interrupciones de cadena de suministro como la que vivimos. El costo es una inversión inicial en cualificación de nuevos proveedores y posiblemente precios ligeramente más altos al inicio, pero el beneficio es resiliencia operativa y mejor posición negociadora a largo plazo. Esto también afecta directamente al equipo de operaciones, que tendrá una carga de trabajo adicional durante la transición.",
    scenario: {
      title: "Diversificación de proveedores",
      domain: "Operaciones",
      role: "Director de Operaciones",
      objective: "Reducir dependencia de proveedor único tras interrupción reciente.",
      stakeholders: [
        { name: "Equipo de operaciones", role: "interno", interests: "carga de trabajo", influence: "media" },
      ],
    },
  },
  {
    label: "4. EN MCQ-style — chosen option + justification",
    language: "en",
    studentInput:
      "Negotiate expedited partial shipments with the disrupted supplier, accepting higher costs temporarily.\n\nJustification: I would prioritize keeping retail partners stocked over short-term margin because a stock-out would push customers to competitors and the relationship took years to build.",
    scenario: {
      title: "Supply chain disruption",
      domain: "Operations",
      role: "Director of Supply Chain",
      objective: "Maintain customer continuity during supplier failure.",
      stakeholders: [
        { name: "Retail partners", role: "buyer", interests: "stock", influence: "high" },
      ],
    },
    decisionPoints: [
      {
        number: 1,
        prompt: "How should the company respond to the supply chain disruption?",
        format: "multiple_choice",
        options: ["A", "B", "C", "D"],
        primaryDimension: "tradeoffAwareness",
      } as any,
    ],
  },
  {
    label: "5. EN free-response — neutral statement, partial signals",
    language: "en",
    studentInput:
      "I think we should look at the data first. There are several stakeholders to consider including the engineering team and the customers. We need to weigh costs against benefits before committing.",
    scenario: {
      title: "Strategic launch decision",
      domain: "Product",
      role: "Product Lead",
      objective: "Decide on launch timing.",
    },
  },
];

interface SlotResult {
  sample: string;
  signal: string;
  quality: number;
  confidenceOk: boolean;
  marginalEvidenceOk: boolean; // only meaningful when quality > 0
}

async function main() {
  console.log("\n=== TASK 2 VALIDATION — confidence + marginal_evidence coverage ===\n");

  const slotResults: SlotResult[] = [];

  for (const sample of SAMPLES) {
    const ctx: AgentContext = {
      sessionId: `coverage-${Date.now()}`,
      turnCount: 0,
      currentDecision: 1,
      currentKpis: {} as any,
      history: [],
      studentInput: sample.studentInput,
      language: sample.language,
      scenario: sample.scenario,
      decisionPoints: sample.decisionPoints,
    };
    const log = await extractSignals(ctx);
    console.log(`\n${sample.label}`);
    console.log(`  raw_signal_scores: ${JSON.stringify(log.raw_signal_scores)}`);
    for (const k of SIGNAL_KEYS) {
      const s = log.signals_detected[k];
      const confidenceOk = s.confidence === "high" || s.confidence === "medium" || s.confidence === "low";
      const marginalEvidenceOk =
        s.quality === SignalQuality.ABSENT ||
        (typeof s.marginal_evidence === "string" && s.marginal_evidence.length > 0);
      console.log(
        `    ${k.padEnd(22)} q=${s.quality}  conf=${(s.confidence ?? "-").padEnd(6)} mev=${(s.marginal_evidence ?? "").slice(0, 60)}`,
      );
      slotResults.push({
        sample: sample.label,
        signal: k,
        quality: s.quality,
        confidenceOk,
        marginalEvidenceOk,
      });
    }
  }

  // Coverage stats
  const total = slotResults.length;
  const confTotal = slotResults.length;
  const confPopulated = slotResults.filter((r) => r.confidenceOk).length;
  const mevApplicable = slotResults.filter((r) => r.quality > 0).length;
  const mevPopulated = slotResults.filter((r) => r.quality > 0 && r.marginalEvidenceOk).length;

  const confPct = ((confPopulated / confTotal) * 100).toFixed(1);
  const mevPct = mevApplicable === 0 ? "n/a" : ((mevPopulated / mevApplicable) * 100).toFixed(1);

  console.log("\n=== COVERAGE SUMMARY ===");
  console.log(`Total signal slots                : ${total} (5 samples × 5 signals)`);
  console.log(`confidence populated              : ${confPopulated}/${confTotal}  (${confPct}%)`);
  console.log(`marginal_evidence populated where quality > 0 : ${mevPopulated}/${mevApplicable}  (${mevPct}%)`);

  const passConf = parseFloat(confPct) >= 95;
  const passMev = mevApplicable === 0 || parseFloat(mevPct) >= 95;
  console.log(`\nGate (≥95% on both): ${passConf && passMev ? "PASS" : "FAIL"}`);
  console.log(
    `  confidence: ${passConf ? "PASS" : "FAIL"} (${confPct}%)`,
  );
  console.log(
    `  marginal_evidence: ${passMev ? "PASS" : "FAIL"} (${mevPct}%)`,
  );

  // Find any unpopulated slots so debugging is easy
  const offenders = slotResults.filter(
    (r) => !r.confidenceOk || (r.quality > 0 && !r.marginalEvidenceOk),
  );
  if (offenders.length > 0) {
    console.log("\nOffenders:");
    for (const o of offenders) {
      console.log(
        `  ${o.sample} :: ${o.signal} (q=${o.quality}) confidenceOk=${o.confidenceOk} marginalEvidenceOk=${o.marginalEvidenceOk}`,
      );
    }
  }

  process.exit(passConf && passMev ? 0 : 1);
}

main().catch((err) => {
  console.error("validation script crashed:", err);
  process.exit(2);
});
