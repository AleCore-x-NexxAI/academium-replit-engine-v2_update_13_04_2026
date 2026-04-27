#!/usr/bin/env tsx
// TASK 3 §3.7 — Helper script for the Tier 2 live recalibration test.
//
// We can't add an `npm run test:tier2-live` entry to package.json (the spec
// forbids editing package.json), so this script is the equivalent shim.
//
// Usage:
//   tsx server/scripts/run_tier2_live.ts          # English fixtures
//   TIER2_LIVE_LANG=es tsx server/scripts/run_tier2_live.ts  # Spanish prompt
//
// Requires OPENAI_API_KEY (or the proxy equivalent) to be configured. Costs
// ~165 LLM calls per language (15 frameworks × ~11 fixtures).
import { spawn } from "node:child_process";
import path from "node:path";

const env = { ...process.env, TIER2_LIVE: "1" };
const testFile = path.resolve(
  process.cwd(),
  "server/__tests__/calibration.tier2Recalibration.test.ts",
);

const child = spawn("npx", ["tsx", "--test", testFile], {
  stdio: "inherit",
  env,
});

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
