import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export const registryFileName = ".mindraw-canvas-registry.json";
export const canvasDirectoryName = "MindrawCanvas";
const mindrawExtension = ".mindraw";
const mindrawBundleId = "com.mindraw.desktop";
const mindrawAppName = "Mindraw";
const defaultMacOpenCommand = "/usr/bin/open";
const defaultCreateBootstrapTimeoutMs = 12000;
const defaultCreateBootstrapPollMs = 350;
const registryVersion = 1;
const maxCanvasSequence = 99;
const blockerCodes = new Set([
  "PROJECT_ROOT_NOT_FOUND",
  "PROJECT_ROOT_NOT_DIRECTORY",
  "PROJECT_ROOT_UNAVAILABLE",
  "CANVAS_DIR_NOT_DIRECTORY",
  "CANVAS_DIR_CREATE_FAILED",
  "CANVAS_DIR_UNAVAILABLE",
  "CANVAS_SEQUENCE_EXHAUSTED",
  "MINDRAW_CANVAS_CREATE_API_REQUIRED",
  "CANVAS_TARGET_ALREADY_EXISTS",
  "MINDRAW_CANVAS_CREATE_FAILED",
  "MINDRAW_PREVIEW_SOURCE_REQUIRED",
  "MINDRAW_APP_API_UNAVAILABLE",
  "MINDRAW_CANVAS_HEALTH_API_REQUIRED",
  "MINDRAW_CANVAS_HEALTH_RESULT_INVALID",
]);
const canvasHealthValues = new Set(["healthy", "repairable", "invalid"]);
const recoveryActionValues = new Set(["repair_current", "open_other_healthy", "create_new"]);

export class MindrawProjectCanvasError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "MindrawProjectCanvasError";
    this.code = code;
    this.details = details;
  }
}

export function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function isObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function defaultCapabilityPath() {
  return process.env.MINDRAW_RUNTIME_CAPABILITY_PATH || path.join(os.homedir(), "Library/Application Support/com.mindraw.desktop/runtime/write-api.json");
}

export function resolveProjectRoot(projectRoot = process.cwd()) {
  return path.resolve(String(projectRoot || process.cwd()));
}

export function resolveCanvasDir(projectRoot) {
  return path.join(resolveProjectRoot(projectRoot), canvasDirectoryName);
}

export function resolveRegistryPath(projectRoot) {
  return path.join(resolveCanvasDir(projectRoot), registryFileName);
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function launchFallbackReason(error) {
  if (!(error instanceof MindrawProjectCanvasError)) return { code: "UNKNOWN" };
  return {
    code: error.code,
    reason: typeof error.details?.reason === "string" ? error.details.reason : null,
  };
}

function canUseLaunchFallback(error) {
  if (!(error instanceof MindrawProjectCanvasError)) return false;
  return new Set([
    "MINDRAW_OPEN_PACKAGE_API_REQUIRED",
    "MINDRAW_APP_API_UNAVAILABLE",
    "APP_API_UNAVAILABLE",
    "TRANSPORT_TIMEOUT",
    "TRANSPORT_UNAVAILABLE",
  ]).has(error.code);
}

function canUseCreateBootstrapFallback(error) {
  if (!(error instanceof MindrawProjectCanvasError)) return false;
  if (error.code !== "MINDRAW_CANVAS_CREATE_API_REQUIRED" && error.code !== "MINDRAW_APP_API_UNAVAILABLE") return false;
  return new Set([
    "CAPABILITY_FILE_NOT_FOUND",
    "APP_API_UNAVAILABLE",
    "TRANSPORT_TIMEOUT",
    "TRANSPORT_UNAVAILABLE",
  ]).has(error.details?.reason);
}

function execFileResult(command, args) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 5000, windowsHide: true }, (error, stdout, stderr) => {
      if (!error) {
        resolve({ ok: true, stdoutLength: Buffer.byteLength(stdout ?? ""), stderrLength: Buffer.byteLength(stderr ?? "") });
        return;
      }
      resolve({
        ok: false,
        exitCode: Number.isInteger(error.code) ? error.code : null,
        signal: typeof error.signal === "string" ? error.signal : null,
        timedOut: error.killed === true,
        stderrRedacted: Boolean(stderr),
      });
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarizeCapabilityError(error) {
  if (!(error instanceof MindrawProjectCanvasError)) return { code: "UNKNOWN" };
  return {
    code: error.code,
    reason: typeof error.details?.reason === "string" ? error.details.reason : null,
    requiredCapability: typeof error.details?.requiredCapability === "string" ? error.details.requiredCapability : null,
  };
}

async function openCanvasViaMacLaunchServices({ canvasPath, cause, launchFallbackCommand = defaultMacOpenCommand, dryRun = false }) {
  const resolvedCanvasPath = path.resolve(canvasPath);
  const fallbackReason = launchFallbackReason(cause);
  if (process.platform !== "darwin") {
    throw new MindrawProjectCanvasError("MINDRAW_OPEN_PACKAGE_API_REQUIRED", "Mindraw openPackage capability is required on this platform.", {
      fallbackAvailable: false,
      fallbackReason,
    });
  }
  if (!(await exists(resolvedCanvasPath))) {
    throw new MindrawProjectCanvasError("CANVAS_PATH_NOT_FOUND", "Cannot launch Mindraw because the project canvas package is not reachable.", {
      canvasPath: resolvedCanvasPath,
      fallbackReason,
    });
  }
  const attempts = [
    { method: "macos.open.bundle", args: ["-b", mindrawBundleId, resolvedCanvasPath] },
    { method: "macos.open.app-name", args: ["-a", mindrawAppName, resolvedCanvasPath] },
    { method: "macos.open.package-association", args: [resolvedCanvasPath] },
  ];
  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      method: attempts[0].method,
      canvasPath: resolvedCanvasPath,
      opened: false,
      fallbackUsed: true,
      fallbackReason,
    };
  }
  const failures = [];
  for (const attempt of attempts) {
    const result = await execFileResult(launchFallbackCommand, attempt.args);
    if (result.ok) {
      return {
        ok: true,
        method: attempt.method,
        canvasPath: resolvedCanvasPath,
        opened: true,
        activated: false,
        frontmost: false,
        focusConfirmed: false,
        fallbackUsed: true,
        fallbackReason,
        launch: {
          bundleId: mindrawBundleId,
          appName: mindrawAppName,
          attemptedMethods: attempts.slice(0, attempts.indexOf(attempt) + 1).map((item) => item.method),
          successfulMethod: attempt.method,
        },
      };
    }
    failures.push({ method: attempt.method, exitCode: result.exitCode, signal: result.signal, timedOut: result.timedOut, stderrRedacted: result.stderrRedacted });
  }
  throw new MindrawProjectCanvasError("MINDRAW_OPEN_PACKAGE_API_REQUIRED", "Mindraw openPackage API is unavailable and macOS launch fallback failed.", {
    fallbackAttempted: true,
    fallbackReason,
    failures,
  });
}

async function launchMindrawAppViaMacLaunchServices({ cause, launchFallbackCommand = defaultMacOpenCommand }) {
  const fallbackReason = launchFallbackReason(cause);
  if (process.platform !== "darwin") {
    throw new MindrawProjectCanvasError("MINDRAW_CANVAS_CREATE_API_REQUIRED", "Mindraw createBlankPackage capability is required on this platform.", {
      fallbackAvailable: false,
      fallbackReason,
    });
  }
  const attempts = [
    { method: "macos.open.bundle.app", args: ["-b", mindrawBundleId] },
    { method: "macos.open.app-name", args: ["-a", mindrawAppName] },
  ];
  const failures = [];
  for (const attempt of attempts) {
    const result = await execFileResult(launchFallbackCommand, attempt.args);
    if (result.ok) {
      return {
        fallbackUsed: true,
        method: attempt.method,
        fallbackReason,
        launch: {
          bundleId: mindrawBundleId,
          appName: mindrawAppName,
          attemptedMethods: attempts.slice(0, attempts.indexOf(attempt) + 1).map((item) => item.method),
          successfulMethod: attempt.method,
        },
      };
    }
    failures.push({ method: attempt.method, exitCode: result.exitCode, signal: result.signal, timedOut: result.timedOut, stderrRedacted: result.stderrRedacted });
  }
  throw new MindrawProjectCanvasError("MINDRAW_CANVAS_CREATE_API_REQUIRED", "Mindraw createBlankPackage API is unavailable and macOS app launch fallback failed.", {
    fallbackAttempted: true,
    fallbackReason,
    failures,
  });
}

async function readJson(targetPath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(targetPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(targetPath, payload) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, stableJson(payload));
  await fs.rename(tmpPath, targetPath);
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function isPathInside(parentPath, candidatePath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function redactedDetails(details = {}) {
  const safe = {};
  for (const [key, value] of Object.entries(details)) {
    if (/(path|dir|root|endpoint|token|secret|authorization)/iu.test(key)) {
      safe[`${key}Redacted`] = true;
    } else {
      safe[key] = value;
    }
  }
  return safe;
}

function createWarning(code, message, details = {}) {
  return { code, message, ...redactedDetails(details) };
}

function makeBlockedState({ projectRoot, canvasDir, registryPath, code, message, details = {}, capabilities = null }) {
  const warning = createWarning(code, message, details);
  return {
    ok: false,
    status: `BLOCKED_${code}`,
    projectRoot,
    canvasDir,
    registryPath,
    latestCreatedCanvasPath: null,
    latestCanvas: null,
    preferredCanvas: null,
    recovery: null,
    nextCanvasName: null,
    canvases: [],
    createBlocker: warning,
    createResult: null,
    preview: null,
    capabilities,
    blockers: [warning],
    gitIgnoreSuggestion: "MindrawCanvas/",
    gitIgnoreModified: false,
    gitIgnoreStatus: { status: "unknown", suggestion: "MindrawCanvas/", modified: false },
    warnings: [warning],
  };
}

async function ensureProjectRoot(projectRoot) {
  const resolvedProjectRoot = resolveProjectRoot(projectRoot);
  try {
    const stat = await fs.stat(resolvedProjectRoot);
    if (!stat.isDirectory()) {
      throw new MindrawProjectCanvasError("PROJECT_ROOT_NOT_DIRECTORY", "Project root is not a directory.", { projectRoot: resolvedProjectRoot });
    }
    return await fs.realpath(resolvedProjectRoot);
  } catch (error) {
    if (error instanceof MindrawProjectCanvasError) throw error;
    if (error?.code === "ENOENT") {
      throw new MindrawProjectCanvasError("PROJECT_ROOT_NOT_FOUND", "Project root does not exist.", { projectRoot: resolvedProjectRoot });
    }
    throw new MindrawProjectCanvasError("PROJECT_ROOT_UNAVAILABLE", "Project root cannot be inspected.", {
      reason: error?.code ?? "UNKNOWN",
      projectRoot: resolvedProjectRoot,
    });
  }
}

async function ensureCanvasDir(projectRoot) {
  const canvasDir = resolveCanvasDir(projectRoot);
  try {
    const stat = await fs.lstat(canvasDir);
    if (!stat.isDirectory()) {
      throw new MindrawProjectCanvasError("CANVAS_DIR_NOT_DIRECTORY", "MindrawCanvas exists but is not a directory.", { canvasDir });
    }
    return canvasDir;
  } catch (error) {
    if (error instanceof MindrawProjectCanvasError) throw error;
    if (error?.code !== "ENOENT") {
      throw new MindrawProjectCanvasError("CANVAS_DIR_UNAVAILABLE", "MindrawCanvas cannot be inspected.", {
        reason: error?.code ?? "UNKNOWN",
        canvasDir,
      });
    }
  }
  try {
    await fs.mkdir(canvasDir, { recursive: true });
    return canvasDir;
  } catch (error) {
    throw new MindrawProjectCanvasError("CANVAS_DIR_CREATE_FAILED", "MindrawCanvas directory could not be created.", {
      reason: error?.code ?? "UNKNOWN",
      canvasDir,
    });
  }
}

async function readRegistry(registryPath, projectRoot, warnings) {
  let registry = null;
  try {
    registry = JSON.parse(await fs.readFile(registryPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    warnings.push(createWarning("REGISTRY_JSON_INVALID", "Registry JSON is damaged; recovered from canvas package names."));
    return null;
  }
  if (!isObject(registry)) {
    warnings.push(createWarning("REGISTRY_SCHEMA_INVALID", "Registry root is not an object; recovered from canvas package names."));
    return null;
  }
  if (registry.version !== registryVersion) {
    warnings.push(createWarning("REGISTRY_VERSION_UNSUPPORTED", "Registry version is unsupported; recovered from canvas package names.", {
      version: registry.version ?? null,
    }));
    return null;
  }
  if (typeof registry.projectRoot === "string" && path.resolve(registry.projectRoot) !== path.resolve(projectRoot)) {
    warnings.push(createWarning("REGISTRY_PROJECT_ROOT_MISMATCH", "Registry belongs to a different project root and was not trusted."));
    return null;
  }
  return registry;
}

function currentDateParts(now = new Date()) {
  return {
    yy: String(now.getFullYear() % 100).padStart(2, "0"),
    mm: String(now.getMonth() + 1).padStart(2, "0"),
    dd: String(now.getDate()).padStart(2, "0"),
  };
}

function parseCanvasName(name) {
  const match = String(name).match(/^(\d{2})\.(\d{2})(\d{2})-(\d{2})\.mindraw$/u);
  if (!match) return null;
  const [, yy, mm, dd, sequence] = match;
  return {
    yy: Number(yy),
    mm: Number(mm),
    dd: Number(dd),
    sequence: Number(sequence),
    sortKey: `${yy}${mm}${dd}${sequence}`,
  };
}

function createdAtFromName(name) {
  const parsed = parseCanvasName(name);
  if (!parsed) return null;
  const year = 2000 + parsed.yy;
  return new Date(Date.UTC(year, parsed.mm - 1, parsed.dd, 0, 0, parsed.sequence)).toISOString();
}

function nextCanvasName(existingNames, now = new Date()) {
  const { yy, mm, dd } = currentDateParts(now);
  const prefix = `${yy}.${mm}${dd}-`;
  const used = new Set(
    existingNames
      .filter((name) => name.startsWith(prefix) && name.endsWith(mindrawExtension))
      .map((name) => parseCanvasName(name)?.sequence ?? null)
      .filter((sequence) => Number.isInteger(sequence) && sequence >= 1 && sequence <= maxCanvasSequence),
  );
  for (let sequence = 1; sequence <= maxCanvasSequence; sequence += 1) {
    if (!used.has(sequence)) return `${prefix}${String(sequence).padStart(2, "0")}${mindrawExtension}`;
  }
  return null;
}

function normalizeRegistryEntry(entry, { canvasDir, warnings }) {
  if (!isObject(entry)) {
    warnings.push(createWarning("REGISTRY_ENTRY_INVALID", "Registry entry is not an object."));
    return null;
  }
  const name = typeof entry.name === "string" ? path.basename(entry.name) : path.basename(String(entry.path ?? ""));
  if (!name.endsWith(mindrawExtension)) {
    warnings.push(createWarning("REGISTRY_ENTRY_INVALID", "Registry entry does not point to a .mindraw package."));
    return null;
  }
  const entryPath = typeof entry.path === "string" ? path.resolve(entry.path) : null;
  if (entryPath && !isPathInside(canvasDir, entryPath)) {
    warnings.push(createWarning("REGISTRY_ENTRY_OUTSIDE_CANVAS_DIR", "Registry entry points outside this project's MindrawCanvas directory.", { name }));
    return null;
  }
  return {
    name,
    path: entryPath ?? path.join(canvasDir, name),
    createdAt: typeof entry.createdAt === "string" ? entry.createdAt : createdAtFromName(name),
    documentId: typeof entry.documentId === "string" ? entry.documentId : null,
  };
}

async function listCanvasEntries(canvasDir, registry) {
  const registryByName = new Map();
  const warnings = [];
  const registryCanvases = Array.isArray(registry?.canvases) ? registry.canvases : [];
  for (const rawEntry of registryCanvases) {
    const entry = normalizeRegistryEntry(rawEntry, { canvasDir, warnings });
    if (!entry) continue;
    if (registryByName.has(entry.name)) {
      warnings.push(createWarning("REGISTRY_DUPLICATE_ENTRY", "Duplicate registry entry ignored.", { name: entry.name }));
      continue;
    }
    if (!(await pathExists(entry.path))) {
      warnings.push(createWarning("REGISTRY_ENTRY_STALE", "Registry entry points to a missing canvas and was ignored.", { name: entry.name }));
      continue;
    }
    registryByName.set(entry.name, entry);
  }

  const names = [];
  try {
    for (const dirent of await fs.readdir(canvasDir, { withFileTypes: true })) {
      if (dirent.name.endsWith(mindrawExtension) && (dirent.isDirectory() || dirent.isFile())) {
        names.push(dirent.name);
      }
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const canvases = [];
  for (const name of names.sort()) {
    const canvasPath = path.join(canvasDir, name);
    const registryEntry = registryByName.get(name);
    const parsed = parseCanvasName(name);
    if (!parsed) warnings.push(createWarning("CANVAS_NAME_NONSTANDARD", "Canvas name does not follow YY.MMDD-NN.mindraw.", { name }));
    canvases.push({
      name,
      path: canvasPath,
      createdAt: registryEntry?.createdAt ?? createdAtFromName(name) ?? null,
      documentId: registryEntry?.documentId ?? null,
      nameSortKey: parsed?.sortKey ?? null,
    });
  }
  return { canvases, warnings };
}

async function findGitRoot(startPath) {
  let current = path.resolve(startPath);
  while (true) {
    if (await pathExists(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function inspectGitIgnoreStatus(projectRoot) {
  const gitRoot = await findGitRoot(projectRoot);
  if (!gitRoot) {
    return { status: "notGitRepo", suggestion: "MindrawCanvas/", modified: false };
  }
  const gitIgnorePath = path.join(gitRoot, ".gitignore");
  let ignored = false;
  try {
    const lines = (await fs.readFile(gitIgnorePath, "utf8")).split(/\r?\n/u).map((line) => line.trim());
    ignored = lines.some((line) => line === "MindrawCanvas/" || line === "/MindrawCanvas/" || line === "MindrawCanvas");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      return { status: "unknown", suggestion: "MindrawCanvas/", modified: false, gitRootRedacted: true };
    }
  }
  return {
    status: ignored ? "alreadyIgnored" : "suggested",
    suggestion: "MindrawCanvas/",
    modified: false,
  };
}

function compareCanvasCreated(a, b) {
  const aSort = a.nameSortKey ?? parseCanvasName(a.name)?.sortKey ?? "";
  const bSort = b.nameSortKey ?? parseCanvasName(b.name)?.sortKey ?? "";
  if (aSort !== bSort) return aSort.localeCompare(bSort);
  const aCreated = a.createdAt ?? "";
  const bCreated = b.createdAt ?? "";
  if (aCreated !== bCreated) return aCreated.localeCompare(bCreated);
  return a.name.localeCompare(b.name);
}

function chooseLatestCanvas(canvases) {
  if (!canvases.length) return null;
  return [...canvases].sort(compareCanvasCreated).at(-1);
}

function redactCanvasHealth(canvas, health) {
  return {
    name: canvas.name,
    health: health.status,
    reasonCode: health.reasonCode,
  };
}

function normalizeCanvasHealth(result, canvas) {
  const rawStatus = result?.health ?? result?.status;
  if (!canvasHealthValues.has(rawStatus)) {
    throw new MindrawProjectCanvasError("MINDRAW_CANVAS_HEALTH_RESULT_INVALID", "Mindraw did not return a recognized project canvas health result.", {
      health: typeof rawStatus === "string" ? rawStatus : null,
    });
  }
  return {
    status: rawStatus,
    reasonCode: typeof result?.reasonCode === "string" ? result.reasonCode : null,
    canRepair: rawStatus === "repairable" && result?.canRepair !== false,
    canvasPath: canvas.path,
  };
}

async function getCanvasHealthViaMindraw({ canvas, capabilityPath = defaultCapabilityPath() }) {
  await requireMindrawCapability({
    capabilityPath,
    capabilityName: "legacyCanvasRecovery",
    expected: "read",
    method: "mindraw.app.inspect_legacy_canvas_recovery",
    errorCode: "MINDRAW_CANVAS_HEALTH_API_REQUIRED",
  });
  const result = await callMindrawRpc({
    capabilityPath,
    method: "mindraw.app.inspect_legacy_canvas_recovery",
    params: { packagePath: canvas.path },
  });
  return normalizeCanvasHealth(result, canvas);
}

async function inspectCanvasHealth({ canvases, capabilityPath }) {
  const healthByPath = new Map();
  for (const canvas of canvases) {
    healthByPath.set(canvas.path, await getCanvasHealthViaMindraw({ canvas, capabilityPath }));
  }
  return healthByPath;
}

function preferredCanvasFromRegistry(registry, canvases) {
  const preferredPath = typeof registry?.latestCreatedCanvasPath === "string" ? path.resolve(registry.latestCreatedCanvasPath) : null;
  return preferredPath ? canvases.find((canvas) => canvas.path === preferredPath) ?? null : null;
}

function recoveryModel({ preferredCanvas, preferredHealth, canvases, healthByPath }) {
  if (!preferredCanvas || !preferredHealth || preferredHealth.status === "healthy") return null;
  const otherHealthyCanvases = canvases
    .filter((canvas) => canvas.path !== preferredCanvas.path && healthByPath.get(canvas.path)?.status === "healthy")
    .sort(compareCanvasCreated)
    .reverse()
    .map((canvas) => redactCanvasHealth(canvas, healthByPath.get(canvas.path)));
  return {
    status: preferredHealth.status,
    currentCanvas: redactCanvasHealth(preferredCanvas, preferredHealth),
    message: preferredHealth.status === "repairable"
      ? "当前项目画布需要先修复，Mindraw Codex 不会直接修改画布文件。"
      : "当前项目画布无法自动打开，Mindraw Codex 不会改写或悄悄替换它。",
    options: [
      { action: "repair_current", label: "修复此画布", available: preferredHealth.canRepair === true },
      { action: "open_other_healthy", label: "打开其他可用画布", available: otherHealthyCanvases.length > 0 },
      { action: "create_new", label: "新建画布", available: true },
    ],
    otherHealthyCanvases,
  };
}

export async function readMindrawCapabilities({ capabilityPath = defaultCapabilityPath() } = {}) {
  const capability = await readJson(capabilityPath, null);
  if (!capability) {
    return {
      available: false,
      capabilityPathRedacted: true,
      createBlankPackage: false,
      previewSnapshot: false,
      openPackage: false,
      legacyCanvasRecovery: false,
      deepLinkOpen: false,
      missing: ["createBlankPackage", "previewSnapshot", "openPackage", "legacyCanvasRecovery"],
    };
  }
  const methods = Array.isArray(capability.methods) ? capability.methods : [];
  const capabilities = isObject(capability.capabilities) ? capability.capabilities : {};
  const hasMethod = (name) => methods.includes(name);
  const createBlankPackage = capabilities.createBlankPackage === "write" || hasMethod("mindraw.app.create_blank_package");
  const previewSnapshot = capabilities.previewSnapshot === "read" || hasMethod("mindraw.app.get_preview_snapshot");
  const openPackage = capabilities.openPackage === "write" || hasMethod("mindraw.app.open_package");
  const legacyCanvasRecovery = capabilities.legacyCanvasRecovery === "read" || hasMethod("mindraw.app.inspect_legacy_canvas_recovery");
  const deepLinkOpen = capabilities.deepLinkOpen === "open" || false;
  return {
    available: true,
    capabilityPathRedacted: true,
    contractVersion: capability.contractVersion ?? null,
    pid: capability.pid ?? null,
    createBlankPackage,
    previewSnapshot,
    openPackage,
    legacyCanvasRecovery,
    deepLinkOpen,
    missing: [
      ...(createBlankPackage ? [] : ["createBlankPackage"]),
      ...(previewSnapshot ? [] : ["previewSnapshot"]),
      ...(openPackage ? [] : ["openPackage"]),
      ...(legacyCanvasRecovery ? [] : ["legacyCanvasRecovery"]),
    ],
  };
}

function normalizeEndpoint(capability) {
  return capability?.endpoint ?? capability?.baseUrl ?? null;
}

async function httpJson({ url, token, method = "GET", body, timeoutMs = 3000 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { raw: text };
    }
    if (!response.ok) {
      return { ok: false, code: "TRANSPORT_HTTP_ERROR", httpStatus: response.status, payload };
    }
    return { ok: true, httpStatus: response.status, payload };
  } catch (error) {
    return {
      ok: false,
      code: error.name === "AbortError" ? "TRANSPORT_TIMEOUT" : "TRANSPORT_UNAVAILABLE",
      message: error.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

function rpcEnvelope({ id, method, params }) {
  return {
    jsonrpc: "2.0",
    id,
    method,
    params,
    actor: {
      id: "mindraw-codex-plugin",
      displayName: "Mindraw Codex Plugin",
      version: "0.1.0-alpha",
    },
  };
}

async function readMindrawRuntime({ capabilityPath = defaultCapabilityPath(), requireHealth = true } = {}) {
  const capability = await readJson(capabilityPath, null);
  if (!capability) {
    return { ok: false, code: "CAPABILITY_FILE_NOT_FOUND", message: "Mindraw runtime capability file is not available." };
  }
  const endpoint = normalizeEndpoint(capability);
  if (!endpoint || !String(endpoint).startsWith("http://127.0.0.1:")) {
    return { ok: false, code: "APP_API_UNAVAILABLE", message: "Mindraw App API loopback endpoint is unavailable." };
  }
  if (requireHealth && typeof capability.healthEndpoint === "string") {
    const health = await httpJson({ url: capability.healthEndpoint, token: capability.token, timeoutMs: 2000 });
    if (!health.ok || health.payload?.ok === false) {
      return { ok: false, code: "APP_API_UNAVAILABLE", message: "Mindraw App API health check failed." };
    }
  }
  return { ok: true, capability, endpoint };
}

async function callMindrawRpc({ method, params, capabilityPath = defaultCapabilityPath() }) {
  const runtime = await readMindrawRuntime({ capabilityPath });
  if (!runtime.ok) {
    throw new MindrawProjectCanvasError("MINDRAW_APP_API_UNAVAILABLE", runtime.message, { reason: runtime.code });
  }
  const response = await httpJson({
    url: runtime.endpoint,
    token: runtime.capability.token,
    method: "POST",
    body: rpcEnvelope({ id: `mindraw-plugin-${Date.now()}`, method, params }),
  });
  if (!response.ok) {
    throw new MindrawProjectCanvasError(response.code ?? "MINDRAW_APP_API_UNAVAILABLE", response.message ?? "Mindraw App API request failed.");
  }
  if (response.payload?.error) {
    throw new MindrawProjectCanvasError(
      response.payload.error.code ?? "MINDRAW_APP_API_ERROR",
      response.payload.error.message ?? "Mindraw App API returned an error.",
      response.payload.error.data ?? {},
    );
  }
  return response.payload?.result ?? response.payload;
}

async function requireMindrawCapability({ capabilityPath = defaultCapabilityPath(), capabilityName, expected, method, errorCode }) {
  const runtime = await readMindrawRuntime({ capabilityPath });
  if (!runtime.ok) {
    throw new MindrawProjectCanvasError(errorCode, runtime.message, { reason: runtime.code, capabilityPathRedacted: true });
  }
  const methods = Array.isArray(runtime.capability.methods) ? runtime.capability.methods : [];
  const capabilities = isObject(runtime.capability.capabilities) ? runtime.capability.capabilities : {};
  const advertised = capabilities[capabilityName] === expected || methods.includes(method);
  if (!advertised) {
    throw new MindrawProjectCanvasError(errorCode, `Mindraw capability ${capabilityName} is required.`, {
      requiredCapability: capabilityName,
      requiredMethod: method,
      capabilityPathRedacted: true,
    });
  }
  return runtime.capability;
}

async function waitForMindrawCapability({
  capabilityPath = defaultCapabilityPath(),
  capabilityName,
  expected,
  method,
  errorCode,
  timeoutMs = defaultCreateBootstrapTimeoutMs,
  pollMs = defaultCreateBootstrapPollMs,
}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() <= deadline) {
    try {
      return await requireMindrawCapability({ capabilityPath, capabilityName, expected, method, errorCode });
    } catch (error) {
      lastError = error;
      if (error instanceof MindrawProjectCanvasError && error.details?.requiredCapability && !error.details?.reason) {
        throw error;
      }
      await delay(pollMs);
    }
  }
  throw new MindrawProjectCanvasError(errorCode, `Timed out waiting for Mindraw capability ${capabilityName}.`, {
    reason: "CAPABILITY_WAIT_TIMEOUT",
    timeoutMs,
    capabilityPathRedacted: true,
    lastError: summarizeCapabilityError(lastError),
  });
}

function sanitizePreviewSnapshot(snapshot, canvasPath) {
  if (!isObject(snapshot)) return null;
  const resolveArtifactPath = (value) => {
    if (typeof value !== "string") return null;
    return path.isAbsolute(value) ? path.resolve(value) : path.resolve(canvasPath, value);
  };
  const artifactPath =
    typeof snapshot.artifactPath === "string"
      ? resolveArtifactPath(snapshot.artifactPath)
      : typeof snapshot.path === "string"
        ? resolveArtifactPath(snapshot.path)
        : null;
  if (!artifactPath) return null;
  return {
    available: true,
    source: snapshot.source ?? "mindraw-full-canvas-svg-preview-v1",
    artifactPath,
    mimeType: snapshot.mimeType ?? (artifactPath.endsWith(".svg") ? "image/svg+xml" : artifactPath.endsWith(".png") ? "image/png" : "application/octet-stream"),
    width: Number.isFinite(snapshot.width) ? snapshot.width : null,
    height: Number.isFinite(snapshot.height) ? snapshot.height : null,
    byteLength: Number.isFinite(snapshot.byteLength) ? snapshot.byteLength : null,
    sha256: typeof snapshot.sha256 === "string" ? snapshot.sha256.replace(/^sha256:/u, "") : null,
    sourceContentSha256: typeof snapshot.sourceContentSha256 === "string" ? snapshot.sourceContentSha256.replace(/^sha256:/u, "") : null,
    sourceModifiedAt: typeof snapshot.sourceModifiedAt === "string" ? snapshot.sourceModifiedAt : null,
    previewScope: typeof snapshot.previewScope === "string" ? snapshot.previewScope : null,
    bytesIncluded: false,
    rawBytesPersisted: false,
    dataUrlIncluded: false,
    canvasPath,
  };
}

function previewRevision(snapshot, artifact) {
  const parts = [
    snapshot?.sha256,
    snapshot?.sourceContentSha256,
    snapshot?.sourceModifiedAt,
    snapshot?.byteLength ?? artifact?.size ?? null,
    artifact?.mtimeMs ? Math.round(artifact.mtimeMs) : null,
  ].filter((part) => part !== null && part !== undefined && part !== "");
  return parts.length ? parts.join(":") : null;
}

async function enrichPreviewSnapshot(snapshot) {
  if (!snapshot?.artifactPath) return snapshot;
  try {
    const artifact = await fs.stat(snapshot.artifactPath);
    return {
      ...snapshot,
      byteLength: Number.isFinite(snapshot.byteLength) ? snapshot.byteLength : artifact.size,
      artifactModifiedMs: Math.round(artifact.mtimeMs),
      revision: previewRevision(snapshot, artifact),
    };
  } catch {
    return snapshot;
  }
}

async function createCanvasViaMindraw({ canvasDir, canvasName, capabilityPath = defaultCapabilityPath(), launchFallbackCommand = defaultMacOpenCommand }) {
  const packagePath = path.join(canvasDir, canvasName);
  if (await exists(packagePath)) {
    throw new MindrawProjectCanvasError("CANVAS_TARGET_ALREADY_EXISTS", "Refusing to overwrite an existing Mindraw canvas package.", {
      canvasName,
      packagePath,
    });
  }
  let bootstrap = null;
  const requiredCapability = {
    capabilityPath,
    capabilityName: "createBlankPackage",
    expected: "write",
    method: "mindraw.app.create_blank_package",
    errorCode: "MINDRAW_CANVAS_CREATE_API_REQUIRED",
  };
  try {
    await requireMindrawCapability(requiredCapability);
  } catch (error) {
    if (!canUseCreateBootstrapFallback(error)) throw error;
    const launched = await launchMindrawAppViaMacLaunchServices({ cause: error, launchFallbackCommand });
    await waitForMindrawCapability(requiredCapability);
    bootstrap = {
      ...launched,
      waitedForCapability: true,
      timeoutMs: defaultCreateBootstrapTimeoutMs,
    };
  }
  const result = await callMindrawRpc({
    capabilityPath,
    method: "mindraw.app.create_blank_package",
    params: { packagePath },
  });
  if (result.overwritten === true) {
    throw new MindrawProjectCanvasError("MINDRAW_CANVAS_CREATE_FAILED", "Mindraw refused overwrite protection by reporting an overwritten canvas.", {
      canvasName,
    });
  }
  const createdPath = typeof result.packagePath === "string" ? path.resolve(result.packagePath) : packagePath;
  if (!(await exists(createdPath))) {
    throw new MindrawProjectCanvasError("MINDRAW_CANVAS_CREATE_FAILED", "Mindraw createBlankPackage returned success but package path is not reachable.", {
      canvasName,
    });
  }
  const previewSnapshot = await enrichPreviewSnapshot(sanitizePreviewSnapshot(result.previewSnapshot ?? result.preview ?? null, createdPath));
  return {
    name: path.basename(createdPath),
    path: createdPath,
    createdAt: typeof result.createdAt === "string" ? result.createdAt : new Date().toISOString(),
    documentId: typeof result.documentId === "string" ? result.documentId : null,
    created: result.created === true,
    overwritten: result.overwritten === true,
    previewSnapshot,
    bootstrap,
  };
}

async function getPreviewSnapshotViaMindraw({ canvasPath, capabilityPath = defaultCapabilityPath() }) {
  await requireMindrawCapability({
    capabilityPath,
    capabilityName: "previewSnapshot",
    expected: "read",
    method: "mindraw.app.get_preview_snapshot",
    errorCode: "MINDRAW_PREVIEW_SOURCE_REQUIRED",
  });
  const result = await callMindrawRpc({
    capabilityPath,
    method: "mindraw.app.get_preview_snapshot",
    params: { packagePath: canvasPath },
  });
  const snapshot = sanitizePreviewSnapshot(result.previewSnapshot ?? result.snapshot ?? result, canvasPath);
  if (!snapshot || !(await exists(snapshot.artifactPath))) {
    return {
      available: false,
      code: "MINDRAW_PREVIEW_SOURCE_REQUIRED",
      message: "Mindraw previewSnapshot did not return a reachable approved preview artifact.",
    };
  }
  return await enrichPreviewSnapshot(snapshot);
}

function registryPayload({ projectRoot, canvases, latest, warnings }) {
  return {
    version: registryVersion,
    projectRoot,
    createdAt: new Date().toISOString(),
    canvases: canvases.map((canvas) => ({
      name: canvas.name,
      path: canvas.path,
      createdAt: canvas.createdAt,
      documentId: canvas.documentId,
    })),
    latestCreatedCanvasPath: latest?.path ?? null,
    warnings,
  };
}

export async function inspectProjectCanvas({ projectRoot = process.cwd(), createNew = false, capabilityPath = defaultCapabilityPath(), launchFallbackCommand = defaultMacOpenCommand } = {}) {
  const requestedProjectRoot = resolveProjectRoot(projectRoot);
  let resolvedProjectRoot;
  try {
    resolvedProjectRoot = await ensureProjectRoot(requestedProjectRoot);
  } catch (error) {
    if (error instanceof MindrawProjectCanvasError) {
      return makeBlockedState({
        projectRoot: requestedProjectRoot,
        canvasDir: resolveCanvasDir(requestedProjectRoot),
        registryPath: resolveRegistryPath(requestedProjectRoot),
        code: error.code,
        message: error.message,
        details: error.details,
      });
    }
    throw error;
  }
  const canvasDir = resolveCanvasDir(resolvedProjectRoot);
  const registryPath = resolveRegistryPath(resolvedProjectRoot);
  try {
    await ensureCanvasDir(resolvedProjectRoot);
  } catch (error) {
    if (error instanceof MindrawProjectCanvasError) {
      return makeBlockedState({
        projectRoot: resolvedProjectRoot,
        canvasDir,
        registryPath,
        code: error.code,
        message: error.message,
        details: error.details,
      });
    }
    throw error;
  }

  const warnings = [];
  let registry = await readRegistry(registryPath, resolvedProjectRoot, warnings);
  let listed = await listCanvasEntries(canvasDir, registry);
  let canvases = listed.canvases;
  warnings.push(...listed.warnings);
  const registryPreferredCanvas = preferredCanvasFromRegistry(registry, canvases);
  let latest = chooseLatestCanvas(canvases);
  let nextName = nextCanvasName(canvases.map((canvas) => canvas.name));
  let capabilities = await readMindrawCapabilities({ capabilityPath });
  const gitIgnoreStatus = await inspectGitIgnoreStatus(resolvedProjectRoot);

  let createBlocker = null;
  let createResult = null;
  if (createNew || !latest) {
    if (!nextName) {
      createBlocker = createWarning("CANVAS_SEQUENCE_EXHAUSTED", "No same-day Mindraw canvas sequence is available; refusing to wrap or overwrite.", {
        maxSequence: maxCanvasSequence,
      });
    } else {
      try {
        createResult = await createCanvasViaMindraw({ canvasDir, canvasName: nextName, capabilityPath, launchFallbackCommand });
        canvases.push({
          name: createResult.name,
          path: createResult.path,
          createdAt: createResult.createdAt,
          documentId: createResult.documentId,
          nameSortKey: parseCanvasName(createResult.name)?.sortKey ?? null,
        });
        latest = chooseLatestCanvas(canvases);
        nextName = nextCanvasName(canvases.map((canvas) => canvas.name));
      } catch (error) {
        if (error instanceof MindrawProjectCanvasError) {
          createBlocker = createWarning(error.code, error.message, {
            nextCanvasName: nextName,
            requiredCapability: "createBlankPackage",
            ...error.details,
          });
        } else {
          throw error;
        }
      }
    }
  }
  if (createResult?.bootstrap) {
    capabilities = await readMindrawCapabilities({ capabilityPath });
  }

  let healthByPath = new Map();
  let healthBlocker = null;
  if (canvases.length > 0 && !createBlocker) {
    try {
      healthByPath = await inspectCanvasHealth({ canvases, capabilityPath });
    } catch (error) {
      if (error instanceof MindrawProjectCanvasError) {
        healthBlocker = createWarning(error.code, error.message, error.details);
      } else {
        throw error;
      }
    }
  }

  // A registry is only a preference record. When it is absent, damaged, or stale,
  // the newest candidate remains the current canvas to be checked; it must not be
  // silently skipped merely because an older canvas is healthy.
  const preferredCanvas = createResult
    ? canvases.find((canvas) => canvas.path === createResult.path) ?? null
    : registryPreferredCanvas ?? chooseLatestCanvas(canvases);
  const preferredHealth = preferredCanvas ? healthByPath.get(preferredCanvas.path) ?? null : null;
  const recovery = healthBlocker || !preferredCanvas || preferredHealth?.status === "healthy"
    ? null
    : recoveryModel({ preferredCanvas, preferredHealth, canvases, healthByPath });
  if (!healthBlocker && !recovery) {
    latest = chooseLatestCanvas(canvases.filter((canvas) => healthByPath.get(canvas.path)?.status === "healthy"));
  } else if (healthBlocker || recovery) {
    latest = null;
  }

  let preview = null;
  if (latest) {
    if (createResult?.previewSnapshot?.available && createResult.path === latest.path) {
      preview = createResult.previewSnapshot;
    } else {
      try {
        preview = await getPreviewSnapshotViaMindraw({ canvasPath: latest.path, capabilityPath });
      } catch (error) {
        if (error instanceof MindrawProjectCanvasError) {
          preview = {
            available: false,
            code: error.code,
            message: error.message,
          };
        } else {
          throw error;
        }
      }
    }
  }
  const effectiveWarnings = [...warnings];
  if (healthBlocker) effectiveWarnings.push(healthBlocker);
  if (preview && !preview.available) effectiveWarnings.push({ code: preview.code, message: preview.message });
  if (createBlocker) effectiveWarnings.push(createBlocker);
  if (latest && preview && !preview.available && !effectiveWarnings.some((warning) => blockerCodes.has(warning.code))) {
    effectiveWarnings.push(createWarning("MINDRAW_PREVIEW_SOURCE_REQUIRED", "Mindraw did not provide a fresh approved preview artifact.", {
      reason: preview.code ?? "UNKNOWN_PREVIEW_FAILURE",
    }));
  }

  const nextRegistry = registryPayload({ projectRoot: resolvedProjectRoot, canvases, latest: latest ?? preferredCanvas, warnings: effectiveWarnings });
  await writeJson(registryPath, nextRegistry);
  const blockers = effectiveWarnings.filter((warning) => blockerCodes.has(warning.code));
  const status = recovery
    ? "ACTION_REQUIRED_CANVAS_RECOVERY"
    : blockers.length
    ? `BLOCKED_${blockers[0].code}`
    : latest
      ? preview?.available
        ? "READY"
        : "BLOCKED_MINDRAW_PREVIEW_SOURCE_REQUIRED"
      : "BLOCKED_MINDRAW_CANVAS_CREATE_API_REQUIRED";

  return {
    ok: Boolean(latest && preview?.available && !createBlocker && !healthBlocker && !recovery),
    status,
    projectRoot: resolvedProjectRoot,
    canvasDir,
    registryPath,
    latestCreatedCanvasPath: (latest ?? preferredCanvas)?.path ?? null,
    latestCanvas: latest,
    preferredCanvas: preferredCanvas ? redactCanvasHealth(preferredCanvas, preferredHealth ?? { status: "unknown", reasonCode: null }) : null,
    recovery,
    nextCanvasName: nextName,
    canvases,
    createBlocker,
    createResult: createResult
      ? {
          name: createResult.name,
          path: createResult.path,
          documentId: createResult.documentId,
          created: createResult.created,
          overwritten: createResult.overwritten,
          bootstrap: createResult.bootstrap,
        }
      : null,
    preview,
    capabilities,
    blockers,
    gitIgnoreSuggestion: "MindrawCanvas/",
    gitIgnoreModified: false,
    gitIgnoreStatus,
    warnings: effectiveWarnings,
  };
}

async function repairCanvasViaMindraw({ canvasPath, capabilityPath = defaultCapabilityPath() }) {
  await requireMindrawCapability({
    capabilityPath,
    capabilityName: "legacyCanvasRecovery",
    expected: "write",
    method: "mindraw.app.inspect_legacy_canvas_recovery",
    errorCode: "MINDRAW_CANVAS_REPAIR_API_REQUIRED",
  });
  await requireMindrawCapability({
    capabilityPath,
    capabilityName: "openPackage",
    expected: "write",
    method: "mindraw.app.open_package",
    errorCode: "MINDRAW_CANVAS_REPAIR_API_REQUIRED",
  });
  const result = await callMindrawRpc({
    capabilityPath,
    method: "mindraw.app.open_package",
    params: { packagePath: canvasPath },
  });
  if (result.opened !== true) {
    throw new MindrawProjectCanvasError("MINDRAW_CANVAS_REPAIR_FAILED", "Mindraw did not confirm that the selected project canvas was repaired.");
  }
  return { repaired: true, opened: true, backupCreated: result.legacyRecovery?.backupPath ? true : null };
}

export async function performProjectCanvasRecovery({ projectRoot = process.cwd(), action, canvasName = null, capabilityPath = defaultCapabilityPath(), launchFallbackCommand = defaultMacOpenCommand, dryRunOpen = false } = {}) {
  if (!recoveryActionValues.has(action)) {
    throw new MindrawProjectCanvasError("CANVAS_RECOVERY_ACTION_INVALID", "A recognized project canvas recovery action is required.");
  }
  const initial = await inspectProjectCanvas({ projectRoot, capabilityPath, launchFallbackCommand });
  if (action === "create_new") {
    const state = await inspectProjectCanvas({ projectRoot, createNew: true, capabilityPath, launchFallbackCommand });
    return { action, state };
  }
  if (!initial.recovery?.currentCanvas?.name) {
    throw new MindrawProjectCanvasError("CANVAS_RECOVERY_NOT_REQUIRED", "The current project canvas does not require a recovery choice.");
  }
  if (action === "repair_current") {
    const repair = initial.recovery.options?.find((option) => option.action === action);
    if (repair?.available !== true || initial.preferredCanvas?.health !== "repairable") {
      throw new MindrawProjectCanvasError("CANVAS_REPAIR_NOT_AVAILABLE", "Mindraw did not mark the current project canvas as safely repairable.");
    }
    const repaired = await repairCanvasViaMindraw({ canvasPath: initial.latestCreatedCanvasPath, capabilityPath });
    const state = await inspectProjectCanvas({ projectRoot, capabilityPath, launchFallbackCommand });
    return { action, repaired, state };
  }
  const candidates = initial.recovery.otherHealthyCanvases ?? [];
  const chosen = candidates.find((canvas) => canvas.name === canvasName) ?? null;
  if (!chosen) {
    throw new MindrawProjectCanvasError("CANVAS_HEALTHY_SELECTION_REQUIRED", "Choose one of the available healthy project canvases.");
  }
  const selected = initial.canvases.find((canvas) => canvas.name === chosen.name) ?? null;
  if (!selected) {
    throw new MindrawProjectCanvasError("CANVAS_HEALTHY_SELECTION_REQUIRED", "The selected healthy project canvas is no longer available.");
  }
  const opened = await openCanvasInMindraw({ canvasPath: selected.path, healthConfirmed: true, dryRun: dryRunOpen, capabilityPath, launchFallbackCommand });
  return { action, opened, state: initial };
}

export async function openCanvasInMindraw({ canvasPath, healthConfirmed = false, dryRun = false, capabilityPath = defaultCapabilityPath(), launchFallbackCommand = defaultMacOpenCommand } = {}) {
  if (!canvasPath) {
    throw new MindrawProjectCanvasError("CANVAS_PATH_REQUIRED", "A .mindraw path is required to open Mindraw.");
  }
  if (healthConfirmed !== true) {
    throw new MindrawProjectCanvasError("MINDRAW_CANVAS_HEALTH_CONFIRMATION_REQUIRED", "Mindraw must confirm that a project canvas is healthy before it can be opened by M4C.");
  }
  try {
    await requireMindrawCapability({
      capabilityPath,
      capabilityName: "openPackage",
      expected: "write",
      method: "mindraw.app.open_package",
      errorCode: "MINDRAW_OPEN_PACKAGE_API_REQUIRED",
    });
  } catch (error) {
    if (canUseLaunchFallback(error)) {
      return openCanvasViaMacLaunchServices({ canvasPath, cause: error, launchFallbackCommand, dryRun });
    }
    throw error;
  }
  if (dryRun) {
    return { ok: true, dryRun: true, method: "mindraw.app.open_package", canvasPath, fallbackUsed: false };
  }
  let result;
  try {
    result = await callMindrawRpc({
      capabilityPath,
      method: "mindraw.app.open_package",
      params: { packagePath: canvasPath },
    });
  } catch (error) {
    if (canUseLaunchFallback(error)) {
      return openCanvasViaMacLaunchServices({ canvasPath, cause: error, launchFallbackCommand });
    }
    throw error;
  }
  if (result.opened !== true) {
    throw new MindrawProjectCanvasError("PACKAGE_OPEN_FAILED", "Mindraw did not confirm the package was opened.", {
      canvasPath,
    });
  }
  return {
    ok: true,
    method: "mindraw.app.open_package",
    canvasPath: typeof result.packagePath === "string" ? path.resolve(result.packagePath) : canvasPath,
    documentId: typeof result.documentId === "string" ? result.documentId : null,
    opened: true,
    activation: isObject(result.activation) ? result.activation : null,
    focus: isObject(result.focus) ? result.focus : null,
    activated: result.activated === true,
    frontmost: result.frontmost === true,
    focusConfirmed: result.focusConfirmed === true || result.frontmost === true || result.activated === true,
    fallbackUsed: false,
  };
}

export function publicState(state) {
  return {
    ok: state.ok,
    status: state.status,
    projectRoot: state.projectRoot,
    canvasDir: state.canvasDir,
    registryPath: state.registryPath,
    latestCreatedCanvasPath: state.latestCreatedCanvasPath,
    latestCanvas: state.latestCanvas,
    preferredCanvas: state.preferredCanvas ?? null,
    recovery: state.recovery ?? null,
    nextCanvasName: state.nextCanvasName,
    canvasCount: state.canvases.length,
    createBlocker: state.createBlocker,
    createResult: state.createResult,
    preview: state.preview
      ? {
          ...state.preview,
          artifactPath: state.preview.available ? "<local-preview-artifact>" : undefined,
          canvasPath: undefined,
        }
      : null,
    capabilities: state.capabilities,
    blockers: state.blockers,
    gitIgnoreSuggestion: state.gitIgnoreSuggestion,
    gitIgnoreModified: state.gitIgnoreModified,
    gitIgnoreStatus: state.gitIgnoreStatus,
    warnings: state.warnings,
  };
}
