import { backfillSessionAnalytics } from "./backfillSessionAnalytics";

async function main() {
  const args = process.argv.slice(2);
  const opts: { sessionId?: string; scenarioId?: string; dryRun?: boolean } = {};
  for (const a of args) {
    if (a === "--dry-run") opts.dryRun = true;
    else if (a.startsWith("--session=")) opts.sessionId = a.slice("--session=".length);
    else if (a.startsWith("--scenario=")) opts.scenarioId = a.slice("--scenario=".length);
  }

  console.log("[Backfill] Starting with options:", opts);
  const summary = await backfillSessionAnalytics(opts);
  console.log("[Backfill] Summary:", JSON.stringify(summary, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error("[Backfill] Fatal error:", err);
  process.exit(1);
});
