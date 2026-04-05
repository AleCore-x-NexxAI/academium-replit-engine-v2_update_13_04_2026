import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile, writeFile, chmod } from "fs/promises";
import { dirname } from "path";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "@google/generative-ai",
  "@google-cloud/storage",
  "@neondatabase/serverless",
  "axios",
  "connect-pg-simple",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memoizee",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "openid-client",
  "p-limit",
  "p-retry",
  "passport",
  "passport-local",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

// CJS shim that dynamically imports the ESM bundle
const CJS_SHIM = `// CJS shim to load ESM bundle - works with "type": "module" in package.json
(async () => {
  try {
    console.log('Starting server...');
    await import('./index.mjs');
    console.log('Server module loaded successfully');
  } catch (err) {
    console.error('Failed to start server:');
    console.error(err.stack || err.message || err);
    process.exit(1);
  }
})();
`;

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  // Build as ESM to match package.json "type": "module"
  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "esm",
    outfile: "dist/index.mjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
    banner: {
      js: `import { createRequire } from 'module'; import { fileURLToPath } from 'url'; import { dirname } from 'path'; const require = createRequire(import.meta.url); const __filename = fileURLToPath(import.meta.url); const __dirname = dirname(__filename);`,
    },
  });

  console.log("writing CJS shim...");
  await writeFile("dist/index.cjs", CJS_SHIM);

  const nodeDir = dirname(process.execPath);
  const startScript = `#!/bin/sh
# Try node from PATH first, then fall back to build-time node path
if command -v node >/dev/null 2>&1; then
  exec node dist/index.cjs "$@"
elif [ -x "${nodeDir}/node" ]; then
  exec "${nodeDir}/node" dist/index.cjs "$@"
else
  # Search nix store for any node binary
  for f in /nix/store/*/bin/node; do
    if [ -x "$f" ]; then
      exec "$f" dist/index.cjs "$@"
    fi
  done
  echo "ERROR: Could not find node binary"
  exit 1
fi
`;
  console.log("writing startup script (node at build time: " + process.execPath + ")...");
  await writeFile("dist/start.sh", startScript);
  await chmod("dist/start.sh", 0o755);
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
