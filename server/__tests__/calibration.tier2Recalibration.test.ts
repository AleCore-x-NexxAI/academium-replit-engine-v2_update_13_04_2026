// TASK 3 §3.7 — Tier 2 four-tier evidence_level recalibration regression suite.
//
// Two modes:
//
//   • Pure mode (default, runs under `npm test`):
//     Validates the fixture file structure and the
//     `_mapEvidenceLevelToDetection` mapping function. No LLM calls.
//
//   • Live mode (TIER2_LIVE=1, gated):
//     For each fixture input, calls the real `detectFrameworks` against the
//     OpenAI proxy. Computes per-framework pass rates per tier and asserts
//     against the thresholds:
//
//       should_apply_strong   ≥ 80%
//       should_apply_weak     ≥ 75%
//       should_apply_explicit ≥ 90%
//       should_NOT_apply      ≥ 90%
//
//     Prints a markdown table to stdout so you can see which frameworks need
//     recognition-signal work (TASK 3 §3.6). Run via:
//       TIER2_LIVE=1 tsx --test server/__tests__/calibration.tier2Recalibration.test.ts
//     or via the helper script:
//       tsx server/scripts/run_tier2_live.ts
//
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  detectFrameworks,
  _mapEvidenceLevelToDetection,
  type EvidenceLevel,
} from "../agents/frameworkDetector";
import { getRegistryEntryById } from "../agents/frameworkRegistry";
import { SignalQuality, type SignalExtractionResult } from "../agents/types";
import type { CaseFramework, FrameworkDetection } from "@shared/schema";

type FixtureEntry = { input: string; rationale: string };
type FrameworkFixtures = {
  should_apply_strong: FixtureEntry[];
  should_apply_weak: FixtureEntry[];
  should_apply_explicit: FixtureEntry[];
  should_NOT_apply: FixtureEntry[];
};
type FixtureFile = { _meta?: unknown } & Record<string, FrameworkFixtures>;

const TIER_KEYS: Array<keyof FrameworkFixtures> = [
  "should_apply_strong",
  "should_apply_weak",
  "should_apply_explicit",
  "should_NOT_apply",
];

const PASS_THRESHOLDS: Record<keyof FrameworkFixtures, number> = {
  should_apply_strong: 0.8,
  should_apply_weak: 0.75,
  should_apply_explicit: 0.9,
  should_NOT_apply: 0.9,
};

const FIXTURE_PATH = path.resolve(
  process.cwd(),
  "server/__tests__/fixtures/tier2_recalibration.json",
);

function loadFixtures(): FixtureFile {
  const raw = readFileSync(FIXTURE_PATH, "utf8");
  return JSON.parse(raw) as FixtureFile;
}

function frameworkKeys(fixtures: FixtureFile): string[] {
  return Object.keys(fixtures).filter((k) => !k.startsWith("_"));
}

// Zero-quality signals neutralise Tier 3 (signal-pattern fallback) so the live
// test isolates Tier 2 (semantic LLM) behaviour cleanly.
const zeroSignals: SignalExtractionResult = {
  intent: { quality: SignalQuality.NONE, extracted_text: "" },
  justification: { quality: SignalQuality.NONE, extracted_text: "" },
  tradeoffAwareness: { quality: SignalQuality.NONE, extracted_text: "" },
  stakeholderAwareness: { quality: SignalQuality.NONE, extracted_text: "" },
  ethicalAwareness: { quality: SignalQuality.NONE, extracted_text: "" },
};

/**
 * Build a CaseFramework from a registry canonicalId. The detector hydrates
 * conceptualDescription + recognitionSignals from the registry on demand, but
 * we pre-hydrate here so the test surfaces missing-rubric problems fast.
 */
function buildFrameworkFromRegistry(canonicalId: string, lang: "en" | "es" = "en"): CaseFramework | null {
  const entry = getRegistryEntryById(canonicalId);
  if (!entry) return null;
  const isEn = lang === "en";
  return {
    id: canonicalId,
    name: isEn ? entry.canonicalName_en : entry.canonicalName_es,
    domainKeywords: isEn ? entry.suggestedDomainKeywords_en : entry.suggestedDomainKeywords_es,
    conceptualDescription: isEn ? entry.conceptualDescription_en : entry.conceptualDescription_es,
    recognitionSignals: isEn ? entry.recognitionSignals_en : entry.recognitionSignals_es,
    canonicalId,
  } as CaseFramework;
}

function predicate(
  tier: keyof FrameworkFixtures,
  det: FrameworkDetection | undefined,
): boolean {
  if (!det) return tier === "should_NOT_apply"; // missing detection ≅ not_evidenced
  const level = det.level;
  const conf = det.confidence;
  switch (tier) {
    case "should_apply_strong":
      // strong_implicit (medium) or explicit
      return (level === "implicit" && conf === "medium") || level === "explicit";
    case "should_apply_weak":
      // weak_implicit (low), strong_implicit (medium), or explicit all qualify
      return level === "implicit" || level === "explicit";
    case "should_apply_explicit":
      return level === "explicit";
    case "should_NOT_apply":
      return level === "not_evidenced";
  }
}

describe("Tier 2 recalibration — pure mode (structure + mapping)", () => {
  it("fixture file loads and has 15 frameworks with all four tiers populated", () => {
    const fixtures = loadFixtures();
    const keys = frameworkKeys(fixtures);
    assert.ok(keys.length >= 15, `expected ≥15 frameworks, got ${keys.length}`);
    for (const k of keys) {
      const fw = fixtures[k];
      for (const tier of TIER_KEYS) {
        assert.ok(Array.isArray(fw[tier]), `${k}.${tier} must be an array`);
        assert.ok(fw[tier].length >= 2, `${k}.${tier} must have ≥2 fixtures`);
        for (const entry of fw[tier]) {
          assert.equal(typeof entry.input, "string", `${k}.${tier}: input must be string`);
          assert.ok(entry.input.length >= 10, `${k}.${tier}: input must be ≥10 chars`);
          assert.equal(typeof entry.rationale, "string", `${k}.${tier}: rationale must be string`);
        }
      }
    }
  });

  it("each fixture framework key resolves to a registry entry", () => {
    const fixtures = loadFixtures();
    for (const k of frameworkKeys(fixtures)) {
      const entry = getRegistryEntryById(k);
      assert.ok(entry, `fixture key '${k}' has no registry entry`);
    }
  });

  it("_mapEvidenceLevelToDetection maps every tier correctly", () => {
    assert.deepEqual(_mapEvidenceLevelToDetection("explicit"), {
      level: "explicit",
      confidence: "high",
    });
    assert.deepEqual(_mapEvidenceLevelToDetection("strong_implicit"), {
      level: "implicit",
      confidence: "medium",
    });
    assert.deepEqual(_mapEvidenceLevelToDetection("weak_implicit"), {
      level: "implicit",
      confidence: "low",
    });
    assert.deepEqual(_mapEvidenceLevelToDetection("none"), {
      level: "not_evidenced",
      confidence: undefined,
    });
    // Defensive: anything unrecognised collapses to "none" mapping.
    assert.deepEqual(_mapEvidenceLevelToDetection("garbage"), {
      level: "not_evidenced",
      confidence: undefined,
    });
  });

  it("pure-mode: a stubbed-LLM verdict per tier flows through detectFrameworks correctly", async () => {
    const fixtures = loadFixtures();
    const keys = frameworkKeys(fixtures);
    const fw = buildFrameworkFromRegistry(keys[0]);
    assert.ok(fw, "first registry-backed framework must exist");

    const longInput =
      "We need to weigh the strategic options carefully across multiple dimensions before committing to a path. The team should align on the rationale and the tradeoffs between the alternatives.";

    const tierToLevel: Record<string, EvidenceLevel> = {
      strong: "strong_implicit",
      weak: "weak_implicit",
      explicit: "explicit",
      none: "none",
    };

    for (const [name, level] of Object.entries(tierToLevel)) {
      const stub = async () => [
        {
          framework_id: fw.id,
          evidence_level: level,
          quotedReasoning: level === "none" ? "" : "weigh the strategic options",
          explanation: `stub: ${name}`,
        },
      ];
      const dets = await detectFrameworks(longInput, zeroSignals, [fw], "en", stub as any);
      assert.equal(dets.length, 1, `tier=${name}: expected one detection`);
      const expected = _mapEvidenceLevelToDetection(level);
      if (expected.level === "not_evidenced") {
        // "none" must fall through to Tier 3, which can't fire here (no signalPattern + zero signals)
        // → final detection is not_evidenced via the no-match path.
        assert.equal(dets[0].level, "not_evidenced", `tier=${name}: expected fallthrough`);
      } else {
        assert.equal(dets[0].level, expected.level, `tier=${name}: level mismatch`);
        assert.equal(dets[0].confidence, expected.confidence, `tier=${name}: confidence mismatch`);
        assert.equal(dets[0].detection_method, "semantic", `tier=${name}: method mismatch`);
      }
    }
  });
});

// -----------------------------------------------------------------------------
// LIVE MODE — gated by TIER2_LIVE=1. Real LLM calls. Skipped under `npm test`.
// -----------------------------------------------------------------------------

const LIVE = process.env.TIER2_LIVE === "1";
const LIVE_LANG = (process.env.TIER2_LIVE_LANG === "es" ? "es" : "en") as "en" | "es";

if (LIVE) {
  describe(`Tier 2 recalibration — LIVE mode (real LLM, lang=${LIVE_LANG})`, () => {
    it("runs all fixtures through detectFrameworks and asserts per-framework thresholds", { timeout: 30 * 60 * 1000 }, async () => {
      const fixtures = loadFixtures();
      let keys = frameworkKeys(fixtures);
      // Optional filter: TIER2_LIVE_FRAMEWORKS=swot,pestel,batna
      if (process.env.TIER2_LIVE_FRAMEWORKS) {
        const allow = new Set(process.env.TIER2_LIVE_FRAMEWORKS.split(",").map((s) => s.trim()));
        keys = keys.filter((k) => allow.has(k));
      }
      console.log(`[live] running ${keys.length} framework(s): ${keys.join(", ")}`);

      type Cell = { pass: number; total: number };
      type Row = Record<keyof FrameworkFixtures, Cell> & { framework: string };
      const report: Row[] = [];
      const failures: string[] = [];

      for (const key of keys) {
        const fw = buildFrameworkFromRegistry(key);
        if (!fw) {
          failures.push(`${key}: missing registry entry`);
          continue;
        }
        const row: Row = {
          framework: key,
          should_apply_strong: { pass: 0, total: 0 },
          should_apply_weak: { pass: 0, total: 0 },
          should_apply_explicit: { pass: 0, total: 0 },
          should_NOT_apply: { pass: 0, total: 0 },
        };

        const t0 = Date.now();
        for (const tier of TIER_KEYS) {
          for (let i = 0; i < fixtures[key][tier].length; i++) {
            const entry = fixtures[key][tier][i];
            const callT0 = Date.now();
            const dets = await detectFrameworks(entry.input, zeroSignals, [fw], LIVE_LANG);
            const det = dets.find((d) => d.framework_id === fw.id);
            const ok = predicate(tier, det);
            row[tier].total += 1;
            if (ok) row[tier].pass += 1;
            console.log(
              `[live] ${key}.${tier}[${i}] ${ok ? "PASS" : "FAIL"} → level=${det?.level ?? "<missing>"} conf=${det?.confidence ?? "-"} method=${det?.detection_method ?? "-"} (${Date.now() - callT0}ms)`,
            );
          }
        }
        console.log(`[live] ${key} complete in ${Date.now() - t0}ms`);
        report.push(row);

        for (const tier of TIER_KEYS) {
          const { pass, total } = row[tier];
          if (total === 0) continue;
          const rate = pass / total;
          if (rate < PASS_THRESHOLDS[tier]) {
            failures.push(
              `${key}.${tier}: ${pass}/${total} = ${(rate * 100).toFixed(1)}% < ${(PASS_THRESHOLDS[tier] * 100).toFixed(0)}%`,
            );
          }
        }
      }

      // Print a markdown table report so the CLI surfaces which frameworks
      // need recognition-signal work (3.6).
      console.log("\n## Tier 2 live recalibration report\n");
      console.log("| framework | strong | weak | explicit | NOT-apply |");
      console.log("| --- | --- | --- | --- | --- |");
      for (const row of report) {
        const cell = (c: Cell) =>
          c.total === 0 ? "n/a" : `${c.pass}/${c.total} (${((c.pass / c.total) * 100).toFixed(0)}%)`;
        console.log(
          `| ${row.framework} | ${cell(row.should_apply_strong)} | ${cell(row.should_apply_weak)} | ${cell(row.should_apply_explicit)} | ${cell(row.should_NOT_apply)} |`,
        );
      }
      console.log("");

      if (failures.length > 0) {
        console.log("### Threshold failures\n");
        for (const f of failures) console.log(`- ${f}`);
      }

      // ≥12 of N frameworks must clear all four thresholds (per spec gate).
      const passingFrameworks = report.filter((row) =>
        TIER_KEYS.every((tier) => {
          const { pass, total } = row[tier];
          if (total === 0) return true;
          return pass / total >= PASS_THRESHOLDS[tier];
        }),
      );
      console.log(
        `\n${passingFrameworks.length}/${report.length} frameworks meet all four thresholds.`,
      );
      assert.ok(
        passingFrameworks.length >= Math.min(12, report.length),
        `Expected ≥${Math.min(12, report.length)} frameworks to clear all thresholds; got ${passingFrameworks.length}. Failures:\n  ${failures.join("\n  ")}`,
      );
    });
  });
}
