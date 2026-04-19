#!/usr/bin/env tsx
/**
 * Phase 1c (Section 6.4) — compatibility-manifest validator.
 *
 * For each entry in compatibility-manifest.json verifies:
 *   1. The endpoint path resolves to an `app.{get,post,patch,delete}(...)`
 *      declaration in server/routes.ts.
 *   2. The `writtenBy` file exists.
 *   3. Every `validatedFields` token appears at least once in shared/schema.ts
 *      (string-match — sufficient for a static compatibility audit).
 *
 * Exit code: 0 on success, 1 if any check fails.
 *
 * Run with: `npx tsx scripts/validate-manifest.ts`
 * Not wired to CI in this phase (see Section 6.4).
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ManifestEntry {
  id: string;
  uiSurface: string;
  endpoint: { path: string; method: string };
  stateField: string;
  writtenBy: string;
  validatedFields: string[];
}

interface Manifest {
  version: string;
  description?: string;
  notes?: string[];
  entries: ManifestEntry[];
}

const ROOT = path.resolve(__dirname, "..");
const MANIFEST_PATH = path.join(ROOT, "compatibility-manifest.json");
const ROUTES_PATH = path.join(ROOT, "server/routes.ts");
const SCHEMA_PATH = path.join(ROOT, "shared/schema.ts");

function readFile(p: string): string {
  return fs.readFileSync(p, "utf8");
}

function endpointPathToRegex(endpointPath: string, method: string): RegExp {
  // Convert /api/scenarios/:scenarioId/class-stats to a regex matching
  // the literal app.<method>("...") declaration in server/routes.ts.
  const escaped = endpointPath
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/:[A-Za-z_][A-Za-z0-9_]*/g, ":[A-Za-z_][A-Za-z0-9_]*");
  return new RegExp(`app\\.${method.toLowerCase()}\\(\\s*["'\`]${escaped}["'\`]`);
}

function main(): void {
  const failures: string[] = [];

  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`[validate-manifest] Missing manifest at ${MANIFEST_PATH}`);
    process.exit(1);
  }
  const manifest: Manifest = JSON.parse(readFile(MANIFEST_PATH));
  const routesSrc = readFile(ROUTES_PATH);
  const schemaSrc = readFile(SCHEMA_PATH);

  console.log(`[validate-manifest] Validating ${manifest.entries.length} entries against ${manifest.version}`);

  for (const entry of manifest.entries) {
    const re = endpointPathToRegex(entry.endpoint.path, entry.endpoint.method);
    if (!re.test(routesSrc)) {
      failures.push(
        `[${entry.id}] endpoint not found: ${entry.endpoint.method} ${entry.endpoint.path} (regex ${re})`,
      );
    }

    const writerPath = path.join(ROOT, entry.writtenBy);
    if (!fs.existsSync(writerPath)) {
      failures.push(`[${entry.id}] writtenBy file missing: ${entry.writtenBy}`);
    }

    for (const field of entry.validatedFields) {
      if (!schemaSrc.includes(field)) {
        failures.push(`[${entry.id}] validatedField "${field}" not found in shared/schema.ts`);
      }
    }
  }

  if (failures.length > 0) {
    console.error(`\n[validate-manifest] FAILED — ${failures.length} issue(s):`);
    for (const f of failures) console.error("  - " + f);
    process.exit(1);
  }
  console.log(`[validate-manifest] OK — all ${manifest.entries.length} entries validated.`);
}

main();
