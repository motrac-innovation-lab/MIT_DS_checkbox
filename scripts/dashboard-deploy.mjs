#!/usr/bin/env node
// Standalone, dependency-free CLI deploy script for the IT Dashboard's
// `/api/cli-deploy/*` API (see backend/src/api/cliDeploy.ts in the dashboard
// repo for the server side of this contract). Meant to be copied verbatim
// into a completely separate project that deploys a `node_upload`/
// `static_upload` application onto the dashboard's fleet -- it has ZERO
// dependency on the dashboard monorepo (no @it-dashboard-scoped imports, no
// workspace resolution assumptions), mirroring the same "self-contained
// artifact shipped to somewhere else" precedent as
// backend/src/orchestration/steps/installAgent.ts's buildTargetPackageJson
// and the other scripts already living in this backend/scripts/ directory.
//
// Only Node 18+ built-ins are used (fetch/FormData/Blob/Headers are globals
// since Node 18, no --experimental flag needed) -- there is nothing to
// `npm install` before running this file.
//
// Configuration:
//   - A `.dashboarddeploy.json` file in the current working directory:
//       { "dashboardUrl": "https://dashboard.example.com",
//         "buildDir": "dist",
//         "buildCommand": "npm run build" }   // optional
//   - The `DASHBOARD_DEPLOY_TOKEN` environment variable. This is the ONE
//     hard security rule in this file: the token is never accepted as a CLI
//     argument (that would leak it into `ps aux`/shell history), and it is
//     never written to stdout/stderr under any circumstance -- including
//     inside an error message, even if a server response body happens to
//     echo something that looks like auth info. See redact() below.
//
// See docs/cli-deploy.md in the dashboard repo for the full operator guide.

import fs from "node:fs/promises";
import path from "node:path";
import { execSync } from "node:child_process";

const CONFIG_FILENAME = ".dashboarddeploy.json";
// Mirrors EXCLUDED_SEGMENTS in backend/src/orchestration/deploy/appFiles.ts --
// keep in sync if that list ever changes.
const EXCLUDED_SEGMENTS = new Set(["node_modules", ".git"]);
// Everything the walk below picks up is uploaded, and a deployed app's
// directory is readable by anyone with dashboard access to that application --
// so a `.env` swept in from the build directory ends up on every replica. That
// is easy to do by accident: `buildDir` is often the project root, `.gitignore`
// is NOT consulted (this walks the filesystem, not the index), and the file
// most likely to be there is the one holding DASHBOARD_DEPLOY_TOKEN itself.
// Matched files abort the run unless --allow-dotenv is passed; they are never
// silently dropped, because an app that genuinely reads a .env at runtime would
// then break with no explanation. `.env.example` is exempt by convention: it
// exists to be committed and holds placeholders, not secrets.
const DOTENV_FILE_RE = /^\.env(\..+)?$/;
const DOTENV_ALLOWED = new Set([".env.example"]);

/** Build-directory-relative paths of any .env-shaped file about to be uploaded. */
function findDotenvFiles(files) {
  return files
    .filter((f) => {
      const name = f.rel.split("/").pop() ?? "";
      return DOTENV_FILE_RE.test(name) && !DOTENV_ALLOWED.has(name);
    })
    .map((f) => f.rel);
}
const MAX_FILE_BYTES = 50 * 1024 * 1024; // matches the server's multer limit
const BATCH_SIZE = 300; // "about 300 files per request", well under the server's 5000/request cap
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;
// Hoeveel opeenvolgende netwerkfouten pollJob() mag uitzitten. Twee deploys
// (2026-08-26, runs 41 en 47) faalden op precies dit punt: uploaden en starten
// waren gelukt, en toen viel één statusaanvraag weg. De deploy zelf liep
// gewoon door op het dashboard, maar de CLI meldde hem als mislukt. Alleen de
// poll is een GET zonder bijwerking, dus alleen die mag opnieuw geprobeerd
// worden -- uploaden en starten nooit.
const POLL_NETWERKFOUTEN_MAX = 5;

/** Thrown for any expected/handled failure -- caught once at the bottom, printed, exit code 1. */
class CliError extends Error {}

// Set once requireToken() resolves it, so redact() can close over it without
// every call site needing to thread the token through as a parameter.
let currentToken = null;

/**
 * Paranoid-by-design: strips the real token (if we know it) plus any
 * Bearer/Authorization-shaped text from a string before it's ever printed.
 * The literal-token replace is the actual guarantee (it's the one secret we
 * hold); the regex passes are defense-in-depth for anything else that merely
 * looks like a credential in an echoed response body.
 */
function redact(text) {
  if (!text) return text;
  let out = String(text);
  if (currentToken) {
    out = out.split(currentToken).join("[REDACTED]");
  }
  out = out.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]");
  out = out.replace(/"?Authorization"?\s*[:=]\s*"?[^",\n]+"?/gi, "Authorization: [REDACTED]");
  return out;
}

// Two deviations from the verbatim copy noted at the top of this file, both deliberate and
// both learned the hard way on 2026-09-09 (four freshly generated tokens rejected in a row):
//  1. Whitespace travelling along with a pasted secret is stripped, like build-cloudflare.mjs
//     does for FLEET_REPO_READ_TOKEN.
//  2. The dashboard's Deploytokens panel shows a new token as a ready-to-paste env line,
//     `DASHBOARD_DEPLOY_TOKEN=<token>`, and its Copy button copies that WHOLE line. Pasted as
//     the value of a GitHub secret, the header becomes `Bearer DASHBOARD_DEPLOY_TOKEN=<token>`
//     and the platform answers 401 "Invalid or revoked deploy token" -- exactly what a dead
//     token gets, so nothing downstream can tell the two apart. 23 chars of prefix + a
//     43-char token = the 66 that kept showing up in the logs. Strip it, and say so.
// Only the LENGTH is ever printed, never the value.
const ENV_PREFIX = "DASHBOARD_DEPLOY_TOKEN=";

function requireToken() {
  const raw = process.env.DASHBOARD_DEPLOY_TOKEN ?? "";
  let token = raw.replace(/\s+/g, "");
  const hadEnvPrefix = token.startsWith(ENV_PREFIX);
  if (hadEnvPrefix) token = token.slice(ENV_PREFIX.length);
  if (!token) {
    throw new CliError(
      "DASHBOARD_DEPLOY_TOKEN is not set. Set it as an environment variable (never as a CLI flag or " +
        "committed anywhere) -- see docs/cli-deploy.md for how to generate one from the application's " +
        "Deploy token panel on the dashboard.",
    );
  }
  console.log(`[dashboard-deploy] Deploy token present (${token.length} characters).`);
  if (hadEnvPrefix) {
    console.log(
      "[dashboard-deploy] NOTE: the secret started with `DASHBOARD_DEPLOY_TOKEN=` -- the whole line from " +
        "the dashboard panel was pasted. The prefix has been stripped; store only the value after `=`.",
    );
  } else if (raw !== token) {
    console.log("[dashboard-deploy] NOTE: the token contained whitespace; it has been stripped.");
  }
  return token;
}

function printUsage() {
  console.log(`Usage: node dashboard-deploy.mjs [options]

Options:
  --no-build          Skip the configured buildCommand entirely.
  --no-clear          Don't clear previously staged files before uploading.
  --message <text>    Deploy description -- becomes the restore point's label.
  --force             Allow deploying over an already-deployed app even if
                       the local build produced no files (wipes every
                       replica -- only pass this if that's really intended).
  --allow-dotenv      Upload .env / .env.<name> files found in the build
                       directory instead of refusing. Only pass this if the
                       app genuinely reads a .env at runtime AND you have
                       confirmed it holds no deploy token or other secret
                       you would not want on every replica.
  -h, --help          Show this help and exit.

Config is read from ${CONFIG_FILENAME} in the current directory.
The deploy token is read from the DASHBOARD_DEPLOY_TOKEN environment
variable -- it is never accepted as a command-line argument.`);
}

function parseArgs(argv) {
  const result = { noBuild: false, noClear: false, force: false, allowDotenv: false, message: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--no-build":
        result.noBuild = true;
        break;
      case "--no-clear":
        result.noClear = true;
        break;
      case "--force":
        result.force = true;
        break;
      case "--allow-dotenv":
        result.allowDotenv = true;
        break;
      case "--message": {
        const value = argv[i + 1];
        if (value === undefined) throw new CliError("--message requires a value.");
        result.message = value;
        i++;
        break;
      }
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
        break;
      default:
        throw new CliError(`Unknown argument: ${arg} (run with --help for usage)`);
    }
  }
  return result;
}

async function loadConfig() {
  const configPath = path.resolve(process.cwd(), CONFIG_FILENAME);
  let raw;
  try {
    raw = await fs.readFile(configPath, "utf8");
  } catch (err) {
    const reason = err && err.code === "ENOENT" ? "file not found" : err.message;
    throw new CliError(
      `Could not read ${CONFIG_FILENAME} in ${process.cwd()} (${reason}). ` +
        `Create one with at least "dashboardUrl" and "buildDir" -- see docs/cli-deploy.md.`,
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new CliError(`${CONFIG_FILENAME} is not valid JSON: ${err.message}`);
  }
  if (!parsed || typeof parsed.dashboardUrl !== "string" || parsed.dashboardUrl.trim() === "") {
    throw new CliError(`${CONFIG_FILENAME} must include a non-empty "dashboardUrl" string.`);
  }
  if (typeof parsed.buildDir !== "string" || parsed.buildDir.trim() === "") {
    throw new CliError(`${CONFIG_FILENAME} must include a non-empty "buildDir" string.`);
  }
  if (parsed.buildCommand !== undefined && parsed.buildCommand !== null && typeof parsed.buildCommand !== "string") {
    throw new CliError(`${CONFIG_FILENAME}'s "buildCommand" must be a string if present.`);
  }
  return {
    dashboardUrl: parsed.dashboardUrl.trim().replace(/\/+$/, ""),
    buildDir: parsed.buildDir,
    buildCommand: parsed.buildCommand || null,
  };
}

function runBuildCommand(buildCommand) {
  console.log(`[dashboard-deploy] Running build command: ${buildCommand}`);
  try {
    // execSync spawns through a shell on both POSIX and Windows by default,
    // and stdio:"inherit" streams the build's own output live rather than
    // buffering it.
    execSync(buildCommand, { stdio: "inherit", cwd: process.cwd() });
  } catch {
    throw new CliError(`Build command failed: ${buildCommand} (see build output above for details).`);
  }
}

async function collectFiles(rootDir) {
  const out = [];
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (EXCLUDED_SEGMENTS.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
      } else if (entry.isFile()) {
        const rel = path.relative(rootDir, abs).split(path.sep).join("/");
        out.push({ abs, rel });
      }
      // Symlinks/other entry types are neither a directory nor a file per
      // Dirent and are silently skipped -- a build output directory has no
      // legitimate reason to contain one.
    }
  }
  try {
    await walk(rootDir);
  } catch (err) {
    throw new CliError(`Could not read build directory "${rootDir}": ${err.message}`);
  }
  return out;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Every call to the dashboard goes through here so the Authorization header is set exactly once, in exactly one place. */
async function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${currentToken}`);
  try {
    return await fetch(url, { ...options, headers });
  } catch (err) {
    const fout = new CliError(`Network error calling ${url}: ${redact(err && err.message ? err.message : String(err))}`);
    // Gemarkeerd zodat pollJob() een hikje tijdens het volgen van een AL
    // gestarte deploy kan uitzitten, terwijl elke andere aanroep er gewoon
    // op afbreekt. Zie POLL_NETWERKFOUTEN_MAX hieronder.
    fout.netwerkfout = true;
    throw fout;
  }
}

async function readErrorBody(res) {
  let text = "";
  try {
    text = await res.text();
  } catch {
    text = "";
  }
  const redacted = redact(text);
  return redacted && redacted.trim() ? redacted : `HTTP ${res.status} ${res.statusText || ""}`.trim();
}

async function clearStaging(dashboardUrl) {
  const res = await apiFetch(`${dashboardUrl}/api/cli-deploy/clear`, { method: "POST" });
  if (!res.ok) {
    throw new CliError(`Failed to clear staging (HTTP ${res.status}): ${await readErrorBody(res)}`);
  }
}

async function uploadFiles(dashboardUrl, files) {
  let uploadedCount = 0;
  let skippedCount = 0;
  const totalBatches = Math.ceil(files.length / BATCH_SIZE);
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
    const form = new FormData();
    const relPaths = [];
    for (const file of batch) {
      let stat;
      try {
        stat = await fs.stat(file.abs);
      } catch (err) {
        console.warn(`[dashboard-deploy] WARNING: skipping ${file.rel} (could not stat: ${err.message})`);
        skippedCount++;
        continue;
      }
      if (stat.size > MAX_FILE_BYTES) {
        console.warn(
          `[dashboard-deploy] WARNING: skipping ${file.rel} (${formatBytes(stat.size)} exceeds the 50MB per-file limit)`,
        );
        skippedCount++;
        continue;
      }
      const buffer = await fs.readFile(file.abs);
      // Field name "files" (repeated once per file) and a filename argument
      // so multer treats each part as a file, not a plain text field --
      // matches upload.array("files") on the server exactly.
      form.append("files", new Blob([buffer]), path.basename(file.rel));
      relPaths.push(file.rel);
    }
    if (relPaths.length === 0) continue; // whole batch was skipped (e.g. all oversized)
    // Field name "paths": one JSON-encoded array of relative path strings,
    // same length/order as the "files" parts just appended above -- exactly
    // what the server's /upload route expects.
    form.append("paths", JSON.stringify(relPaths));
    const res = await apiFetch(`${dashboardUrl}/api/cli-deploy/upload`, { method: "POST", body: form });
    if (!res.ok) {
      throw new CliError(`Upload batch ${batchNumber}/${totalBatches} failed (HTTP ${res.status}): ${await readErrorBody(res)}`);
    }
    const data = await res.json().catch(() => ({}));
    const batchCount = typeof data.fileCount === "number" ? data.fileCount : relPaths.length;
    uploadedCount += batchCount;
    console.log(`[dashboard-deploy] uploaded batch ${batchNumber}/${totalBatches} (${relPaths.length} files)`);
  }
  return { uploadedCount, skippedCount };
}

async function triggerRun(dashboardUrl, description, force) {
  const res = await apiFetch(`${dashboardUrl}/api/cli-deploy/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description: description || undefined, force: Boolean(force) }),
  });
  if (res.status === 409) {
    const data = await res.json().catch(() => ({}));
    if (data && data.emptyStaging) {
      return { emptyStaging: true };
    }
    throw new CliError(`Deploy run rejected (HTTP 409): ${redact(JSON.stringify(data))}`);
  }
  if (!res.ok) {
    throw new CliError(`Failed to start deploy (HTTP ${res.status}): ${await readErrorBody(res)}`);
  }
  const data = await res.json().catch(() => ({}));
  if (!data || typeof data.jobId !== "string") {
    throw new CliError("Deploy started but the server response had no jobId.");
  }
  // Deploy tokens are per-person, so the dashboard attributes this deploy to
  // whoever the token belongs to (audit log, restore point). Optional: an older
  // dashboard won't send it, so treat it as a nice-to-have, never a hard
  // requirement. Only the name/email are ever echoed -- never the token.
  const deployedBy =
    data.deployedBy && typeof data.deployedBy.name === "string" ? { name: data.deployedBy.name, email: data.deployedBy.email } : null;
  return { jobId: data.jobId, deployedBy };
}

async function pollJob(dashboardUrl, jobId) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let netwerkfouten = 0;
  for (;;) {
    let res;
    try {
      res = await apiFetch(`${dashboardUrl}/api/cli-deploy/jobs/${jobId}`, { method: "GET" });
      netwerkfouten = 0;
    } catch (err) {
      // Alleen netwerkfouten, en alleen zolang de deadline nog niet verstreken
      // is. Een HTTP-fout (4xx/5xx) is een antwoord van het dashboard en dus
      // een echt oordeel -- die valt hieronder en breekt wel af.
      if (!err || !err.netwerkfout || ++netwerkfouten > POLL_NETWERKFOUTEN_MAX || Date.now() >= deadline) {
        throw err;
      }
      console.warn(
        `[dashboard-deploy] Statusaanvraag ${netwerkfouten}/${POLL_NETWERKFOUTEN_MAX} mislukt (${err.message}); ` +
        "de deploy loopt door op het dashboard, opnieuw proberen...",
      );
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    if (!res.ok) {
      throw new CliError(`Failed to poll deploy job ${jobId} (HTTP ${res.status}): ${await readErrorBody(res)}`);
    }
    const data = await res.json().catch(() => null);
    if (!data || !data.job) {
      throw new CliError(`Unexpected response while polling deploy job ${jobId}.`);
    }
    if (data.job.status !== "running") {
      return data;
    }
    if (Date.now() >= deadline) {
      throw new CliError(`Timed out after 10 minutes waiting for deploy job ${jobId} to finish (it was still "running").`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  currentToken = requireToken();
  const config = await loadConfig();

  if (args.noBuild) {
    console.log("[dashboard-deploy] --no-build passed -- skipping build step.");
  } else if (!config.buildCommand) {
    console.log("[dashboard-deploy] No buildCommand configured -- skipping build step.");
  } else {
    runBuildCommand(config.buildCommand);
  }

  // Scan BEFORE clearing. Everything below this point up to the clear step is
  // local and read-only, so any reason to abort -- a .env in the build
  // directory, a mistyped buildDir that matches nothing -- is found while the
  // remote staging is still intact. Clearing first would empty the application's
  // staging and only then refuse, leaving it with nothing staged at all.
  const buildDirAbs = path.resolve(process.cwd(), config.buildDir);
  console.log(`[dashboard-deploy] Scanning ${buildDirAbs} ...`);
  const files = await collectFiles(buildDirAbs);
  if (files.length === 0) {
    console.warn(`[dashboard-deploy] WARNING: no files found under ${config.buildDir} -- did the build actually run and produce output?`);
  }

  const dotenvFiles = findDotenvFiles(files);
  if (dotenvFiles.length > 0 && !args.allowDotenv) {
    throw new CliError(
      `Refusing to upload: ${dotenvFiles.length} environment file(s) found inside ${config.buildDir}:\n` +
        dotenvFiles.map((rel) => `  ${rel}`).join("\n") +
        "\n\nEverything under the build directory is uploaded and lands on every replica, where it is " +
        "readable by anyone with dashboard access to this application. Note that .gitignore does not " +
        "apply here -- this walks the filesystem, not git.\n" +
        "Fix it by pointing buildDir at a dedicated build output directory (so your project root's " +
        ".env stays out of it), or move the file elsewhere.\n" +
        "If this app really does read a .env at runtime and you have confirmed it holds no deploy " +
        "token or other secret, re-run with --allow-dotenv.",
    );
  }
  if (dotenvFiles.length > 0) {
    console.warn(
      `[dashboard-deploy] WARNING: --allow-dotenv given -- uploading ${dotenvFiles.length} environment file(s) ` +
        `(${dotenvFiles.join(", ")}) to every replica.`,
    );
  }

  if (args.noClear) {
    console.log("[dashboard-deploy] --no-clear passed -- leaving previously staged files in place.");
  } else {
    console.log("[dashboard-deploy] Clearing remote staging...");
    await clearStaging(config.dashboardUrl);
  }

  const { uploadedCount, skippedCount } = await uploadFiles(config.dashboardUrl, files);
  console.log(
    `[dashboard-deploy] Uploaded ${uploadedCount} file(s)` + (skippedCount ? `, skipped ${skippedCount} (over the 50MB per-file limit)` : "") + ".",
  );

  console.log("[dashboard-deploy] Starting deploy...");
  const runResult = await triggerRun(config.dashboardUrl, args.message || "CLI deploy", args.force);
  if (runResult.emptyStaging) {
    console.error(
      "[dashboard-deploy] Staging is empty and this application has deployed before -- deploying now would remove every file from every replica.",
    );
    console.error("[dashboard-deploy] Re-run with --force if that's really what you want. Not retrying automatically.");
    process.exitCode = 1;
    return;
  }
  const jobId = runResult.jobId;
  if (runResult.deployedBy) {
    // Printed so a wrong/stale token in someone else's .env is obvious here,
    // rather than only later when the dashboard's audit log names the wrong
    // person for this deploy.
    console.log(`[dashboard-deploy] Deploying as: ${runResult.deployedBy.name}`);
  }
  console.log(`[dashboard-deploy] Deploy job started: ${jobId}`);

  const { job, targets } = await pollJob(config.dashboardUrl, jobId);
  console.log(`[dashboard-deploy] Job ${job.id} finished with status: ${job.status}`);
  for (const target of targets) {
    const suffix = target.error ? ` -- ${target.error}` : "";
    console.log(`[dashboard-deploy] target ${target.serverId}: ${target.status}${suffix}`);
  }

  const failed = targets.filter((t) => t.status !== "done");
  if (targets.length === 0) {
    console.error("[dashboard-deploy] FAILED: deploy job finished with no targets at all.");
    process.exitCode = 1;
  } else if (failed.length === 0) {
    console.log("[dashboard-deploy] SUCCESS: all targets deployed.");
    process.exitCode = 0;
  } else {
    console.error(`[dashboard-deploy] FAILED: ${failed.length} of ${targets.length} target(s) did not complete successfully.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  const message = err instanceof CliError ? err.message : err && err.message ? err.message : String(err);
  console.error(`[dashboard-deploy] ERROR: ${redact(message)}`);
  process.exitCode = 1;
});
