/**
 * Section 14.2 — Porter T-002 regression tests for the semantic framework detector.
 *
 * Three cases per the milestone packet (Section 14.2):
 *   (a) Porter-implicit:  focus-strategy reasoning without naming Porter
 *                         → level=implicit, confidence in {medium,high}, detection_method=semantic
 *   (b) Porter-explicit:  student names Porter / uses keyword
 *                         → level=explicit, confidence=high, detection_method=keyword
 *   (c) Porter-unrelated: generic management talk, no framework logic
 *                         → level=not_evidenced
 *
 * The test invokes the REAL `detectFrameworks` against the live LLM (no mocks).
 * If no LLM credential is present in the environment (Replit proxy
 * `AI_INTEGRATIONS_OPENAI_API_KEY` or direct `OPENAI_API_KEY`), the tests
 * FAIL LOUDLY (never skip silently) so `npm test` cannot accidentally turn
 * green without having actually exercised the regression.
 *
 * Run with:
 *   npm test
 *   # or, file-scoped:
 *   npx tsx --test server/__tests__/frameworkDetection.regression.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { CaseFramework, FrameworkDetection } from "@shared/schema";
import { SignalQuality, type SignalExtractionResult } from "../agents/types";
import { detectFrameworks } from "../agents/frameworkDetector";
import { getRegistryEntryById } from "../agents/frameworkRegistry";

function requireOpenAIKey(): void {
  const hasReplitProxy =
    !!process.env.AI_INTEGRATIONS_OPENAI_API_KEY &&
    !!process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const hasDirectKey = !!process.env.OPENAI_API_KEY;
  if (!hasReplitProxy && !hasDirectKey) {
    assert.fail(
      "No OpenAI credential present (AI_INTEGRATIONS_OPENAI_API_KEY/" +
        "AI_INTEGRATIONS_OPENAI_BASE_URL or OPENAI_API_KEY). These tests " +
        "intentionally call the live LLM so the regression cannot pass without " +
        "exercising the real detector. Provision a credential and rerun.",
    );
  }
}

const porterEntry = getRegistryEntryById("porter_generic_strategies");
if (!porterEntry) {
  throw new Error(
    "porter_generic_strategies missing from FRAMEWORK_REGISTRY — registry seed regressed.",
  );
}

const porter: CaseFramework = {
  id: "fw_porter_test",
  name: porterEntry.canonicalName_en,
  domainKeywords: porterEntry.suggestedDomainKeywords_en,
  canonicalId: porterEntry.canonicalId,
  aliases: porterEntry.aliases,
  coreConcepts: porterEntry.coreConcepts_en,
  conceptualDescription: porterEntry.conceptualDescription_en,
  recognitionSignals: porterEntry.recognitionSignals_en,
  signalPattern: porterEntry.suggestedSignalPattern,
};

// All-ABSENT signals so Tier-3 (signal_pattern) cannot fire and confound the
// keyword/semantic verdicts under test.
const absentSignals: SignalExtractionResult = {
  intent: { quality: SignalQuality.ABSENT, extracted_text: "" },
  justification: { quality: SignalQuality.ABSENT, extracted_text: "" },
  tradeoffAwareness: { quality: SignalQuality.ABSENT, extracted_text: "" },
  stakeholderAwareness: { quality: SignalQuality.ABSENT, extracted_text: "" },
  ethicalAwareness: { quality: SignalQuality.ABSENT, extracted_text: "" },
};

function getPorter(detections: FrameworkDetection[]): FrameworkDetection {
  const d = detections.find((x) => x.framework_id === porter.id);
  assert.ok(d, "Detector returned no entry for the Porter framework under test");
  // Universal §14.2 invariant: every detection has all 5 required fields, no nulls.
  assert.ok(d.level, "level missing");
  assert.ok(d.confidence, "confidence missing");
  assert.ok(d.detection_method, "detection_method missing");
  assert.ok(typeof d.evidence === "string", "evidence missing");
  assert.ok(typeof d.reasoning === "string", "reasoning missing");
  return d;
}

test("(a) Porter-implicit: focus-strategy reasoning without naming Porter → implicit / medium+ / semantic", async () => {
  requireOpenAIKey();

  // Focus-strategy logic in plain language: narrowing scope to a specific
  // segment, rejecting the broad market, accepting trade-off of breadth for
  // fit. Carefully avoids every Porter keyword/alias/name so the keyword tier
  // cannot fire — the semantic tier must do the work.
  const studentInput =
    "We can't beat the big chains on price across the whole market, so we should " +
    "pick one specific group of customers — independent boutique cafés in coastal " +
    "towns — and tailor our beans, roast profile, and delivery cadence entirely to " +
    "what they need. Trying to serve everyone would stretch us thin and we'd end up " +
    "average everywhere instead of indispensable somewhere.";

  const detections = await detectFrameworks(studentInput, absentSignals, [porter], "en");
  const d = getPorter(detections);

  assert.equal(d.level, "implicit", `expected implicit, got ${d.level} (${d.reasoning})`);
  assert.ok(
    d.confidence === "medium" || d.confidence === "high",
    `expected confidence medium|high, got ${d.confidence}`,
  );
  assert.equal(
    d.detection_method,
    "semantic",
    `expected detection_method=semantic, got ${d.detection_method}`,
  );
});

test("(b) Porter-explicit: student names Porter / uses keyword → explicit / high / keyword", async () => {
  requireOpenAIKey();

  // Contains both the canonical name and a domain keyword ("differentiation"),
  // either of which alone should trigger the Tier-1 keyword path.
  const studentInput =
    "We should apply Porter's Generic Strategies here — specifically a differentiation " +
    "strategy that lets us charge a premium for our unique single-origin sourcing.";

  const detections = await detectFrameworks(studentInput, absentSignals, [porter], "en");
  const d = getPorter(detections);

  assert.equal(d.level, "explicit", `expected explicit, got ${d.level} (${d.reasoning})`);
  assert.equal(d.confidence, "high", `expected confidence=high, got ${d.confidence}`);
  assert.equal(
    d.detection_method,
    "keyword",
    `expected detection_method=keyword, got ${d.detection_method}`,
  );
});

test("(c) Porter-unrelated: generic management talk, no framework logic → not_evidenced", async () => {
  requireOpenAIKey();

  // Generic team/leadership talk. No positioning logic, no scope choice, no
  // cost-vs-differentiation trade-off. Should not match keywords and should
  // not match semantically.
  const studentInput =
    "We need to improve team morale and run weekly all-hands meetings to communicate " +
    "our goals clearly. Strong leadership and consistent communication are the keys " +
    "to long-term organizational success.";

  const detections = await detectFrameworks(studentInput, absentSignals, [porter], "en");
  const d = getPorter(detections);

  assert.equal(
    d.level,
    "not_evidenced",
    `expected not_evidenced, got ${d.level} (${d.reasoning})`,
  );
});
