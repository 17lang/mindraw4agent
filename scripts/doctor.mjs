#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const jsonMode = process.argv.includes("--json");

function commandExists(command) {
  try {
    execFileSync("/usr/bin/env", ["bash", "-lc", `command -v ${command}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const checks = [
  {
    id: "repo-files",
    level: "error",
    ok: [
      ".agents/plugins/marketplace.json",
      "package.json",
      "scripts/install-local.sh",
      "scripts/uninstall-local.sh",
      "plugins/mindraw/.codex-plugin/plugin.json",
      "plugins/mindraw/.mcp.json",
      "plugins/mindraw/package.json",
      "plugins/mindraw/skills/mindraw-open-canvas/SKILL.md",
      "plugins/mindraw/mcp/server.mjs",
      "plugins/mindraw/lib/project-canvas.mjs",
      "plugins/mindraw/scripts/mindraw-canvas-service.mjs"
    ].every((item) => existsSync(join(root, item))),
    message: "required repository and nested plugin files are present"
  },
  {
    id: "node-version",
    level: "error",
    ok: Number(process.versions.node.split(".")[0]) >= 20,
    message: `node ${process.versions.node}`
  },
  {
    id: "codex-cli",
    level: "warning",
    ok: commandExists("codex"),
    message: "codex CLI is available"
  },
  {
    id: "platform",
    level: "warning",
    ok: process.platform === "darwin" && process.arch === "arm64",
    message: `platform ${process.platform}/${process.arch}; first public target is macOS Apple Silicon`
  },
  {
    id: "mindraw-app",
    level: "warning",
    ok: existsSync("/Applications/Mindraw.app"),
    message: "Mindraw App exists at /Applications/Mindraw.app"
  }
];

const errors = checks.filter((check) => check.level === "error" && !check.ok);
const warnings = checks.filter((check) => check.level === "warning" && !check.ok);
const result = {
  ok: errors.length === 0,
  warnings: warnings.map((check) => check.id),
  repository: "https://github.com/17lang/mindraw4agent",
  root,
  checks
};

if (jsonMode) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  for (const check of checks) {
    const status = check.ok ? "PASS" : check.level === "error" ? "FAIL" : "WARN";
    process.stdout.write(`${status} ${check.id}: ${check.message}\n`);
  }
}

process.exitCode = result.ok ? 0 : 1;
