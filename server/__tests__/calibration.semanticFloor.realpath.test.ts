// §T-003B production-integration tests for the semantic implicit floor.
// These tests exercise the REAL detectFrameworks function from
// server/agents/frameworkDetector.ts by stubbing only the LLM call
// (semanticFrameworkCheck) via the _semanticCheckOverride injection point.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectFrameworks } from "../agents/frameworkDetector";
import { SignalQuality, type SignalExtractionResult } from "../agents/types";
import type { CaseFramework } from "@shared/schema";

const baseSignals: SignalExtractionResult = {
  intent: { quality: SignalQuality.STRONG, extracted_text: "" },
  justification: { quality: SignalQuality.STRONG, extracted_text: "" },
  tradeoffAwareness: { quality: SignalQuality.STRONG, extracted_text: "" },
  stakeholderAwareness: { quality: SignalQuality.STRONG, extracted_text: "" },
  ethicalAwareness: { quality: SignalQuality.STRONG, extracted_text: "" },
};

const baseFramework = (overrides: Partial<CaseFramework> = {}): CaseFramework => ({
  id: "porter",
  name: "Porter Generic Strategies",
  domainKeywords: ["zzznoneverpresent"],
  conceptualDescription: "Competitive positioning via cost leadership, differentiation, focus.",
  recognitionSignals: ["niche", "differentiation", "cost leadership"],
  canonicalId: "porter-gs",
  ...overrides,
} as CaseFramework);

// TASK 3 §3.2: Tier 2 LLM contract is now the four-tier evidence_level enum.
// Translate the legacy (applied, confidence) test inputs into evidence_level so
// these realpath tests still exercise the §T-003B floors:
//   - applied=false  → evidence_level: "none"            (Tier 3 fallthrough)
//   - applied=true + confidence "low"    → "weak_implicit"   (maps to implicit/low)
//   - applied=true + confidence "medium" → "strong_implicit" (maps to implicit/medium)
//   - applied=true + confidence "high"   → "explicit"        (maps to explicit/high)
const fakeVerdict = (
  applied: boolean,
  confidence: "high" | "medium" | "low" = "medium",
) => {
  const evidence_level = !applied
    ? "none"
    : confidence === "high"
      ? "explicit"
      : confidence === "medium"
        ? "strong_implicit"
        : "weak_implicit";
  return async () => [
    {
      framework_id: "porter",
      evidence_level,
      quotedReasoning: applied ? "niche market focus" : "",
      explanation: "Student implicitly references competitive positioning.",
    },
  ];
};

describe("§T-003B realpath — semantic implicit floor via real detectFrameworks", () => {
  it("8 words + signal-pattern matches → Tier 3 catches it (signal_pattern)", async () => {
    const fw = baseFramework({
      domainKeywords: ["niche"],
      signalPattern: {
        requiredSignals: ["intent", "justification"],
        minQuality: "PRESENT",
        additionalKeywords: ["niche"],
      },
    });
    const input = "niche market focus less competition works really great";
    const dets = await detectFrameworks(input, baseSignals, [fw], "en", fakeVerdict(true, "medium") as any);
    assert.strictEqual(dets.length, 1);
    assert.strictEqual(dets[0].level, "implicit");
    assert.strictEqual(dets[0].detection_method, "signal_pattern");
  });

  it("8 words + no signal-pattern match → not_evidenced with floor reasoning", async () => {
    const fw = baseFramework();
    const input = "niche market focus less competition works really great";
    const dets = await detectFrameworks(input, baseSignals, [fw], "en", fakeVerdict(true, "medium") as any);
    assert.strictEqual(dets.length, 1);
    assert.strictEqual(dets[0].level, "not_evidenced");
    assert.ok(dets[0].reasoning.includes("fewer than 10 words"));
  });

  it("12-word input → implicit, semantic, downgraded to confidence low (Floor A)", async () => {
    const fw = baseFramework();
    const input = "I think we should focus on a niche market segment for better results";
    const dets = await detectFrameworks(input, baseSignals, [fw], "en", fakeVerdict(true, "medium") as any);
    assert.strictEqual(dets.length, 1);
    assert.strictEqual(dets[0].level, "implicit");
    assert.strictEqual(dets[0].detection_method, "semantic");
    assert.strictEqual(dets[0].confidence, "low");
  });

  it("20-word input → implicit, semantic, confidence preserved at medium", async () => {
    const fw = baseFramework();
    const input = "We need to consider whether focusing on a specific market niche would give us a competitive advantage over the broader players in this sector area";
    const dets = await detectFrameworks(input, baseSignals, [fw], "en", fakeVerdict(true, "medium") as any);
    assert.strictEqual(dets.length, 1);
    assert.strictEqual(dets[0].level, "implicit");
    assert.strictEqual(dets[0].detection_method, "semantic");
    assert.strictEqual(dets[0].confidence, "medium");
  });

  it("8 words + LLM says applied=false → not_evidenced WITHOUT floor reasoning", async () => {
    const fw = baseFramework();
    const input = "niche market focus less competition works really great";
    const dets = await detectFrameworks(input, baseSignals, [fw], "en", fakeVerdict(false) as any);
    assert.strictEqual(dets.length, 1);
    assert.strictEqual(dets[0].level, "not_evidenced");
    assert.ok(!dets[0].reasoning.includes("fewer than 10 words"));
  });
});
