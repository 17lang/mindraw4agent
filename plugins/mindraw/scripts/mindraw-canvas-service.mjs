#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import { chmod, mkdtemp, mkdir, realpath, rm, stat, utimes, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, relative, resolve as resolvePath } from "node:path";
import { tmpdir } from "node:os";
import {
  inspectProjectCanvas,
  openCanvasInMindraw,
  publicState,
  resolveCanvasDir,
  resolveProjectRoot,
  stableJson
} from "../lib/project-canvas.mjs";

const defaultCanvasPort = 43227;
const projectContextParam = "project";
const serviceProtocolVersion = 2;
const portProbeTimeoutMs = 350;
const maxPortSearchAttempts = 64;

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i += 1;
      }
    } else {
      args._.push(arg);
    }
  }
  return args;
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(stableJson(payload));
}

function projectRootHash(projectRoot) {
  return createHash("sha256").update(resolveProjectRoot(projectRoot)).digest("hex").slice(0, 16);
}

function projectRootLabel(projectRoot) {
  return basename(resolveProjectRoot(projectRoot)) || resolveProjectRoot(projectRoot);
}

async function canonicalizeProjectRoot(projectRoot) {
  const resolvedProjectRoot = resolveProjectRoot(projectRoot);
  try {
    return await realpath(resolvedProjectRoot);
  } catch {
    return resolvedProjectRoot;
  }
}

function serviceIdentity(projectRoot) {
  const resolvedProjectRoot = resolveProjectRoot(projectRoot);
  return {
    service: "mindraw-canvas-service",
    protocolVersion: serviceProtocolVersion,
    projectRoot: resolvedProjectRoot,
    projectRootHash: projectRootHash(resolvedProjectRoot),
    projectLabel: projectRootLabel(resolvedProjectRoot),
    canvasDir: resolveCanvasDir(resolvedProjectRoot),
  };
}

function publicPreviewState(state, projectRoot) {
  const resolvedProjectRoot = resolveProjectRoot(projectRoot || state.projectRoot);
  return {
    ...publicState(state),
    projectRootHash: projectRootHash(resolvedProjectRoot),
    projectLabel: projectRootLabel(resolvedProjectRoot),
    serviceProtocolVersion,
  };
}

function withProjectContext(baseUrl, projectRoot, params = {}) {
  const url = new URL(baseUrl);
  url.searchParams.set(projectContextParam, projectRootHash(projectRoot));
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function requestedProjectRootHash(req, url, body = {}) {
  const headerValue = req.headers["x-mindraw-project-root-hash"];
  return (
    url.searchParams.get(projectContextParam) ||
    url.searchParams.get("projectRootHash") ||
    (typeof body.projectRootHash === "string" ? body.projectRootHash : null) ||
    (typeof body.project === "string" ? body.project : null) ||
    (typeof headerValue === "string" ? headerValue : null)
  );
}

function projectContextMismatchPayload({ projectRoot, receivedProjectRootHash }) {
  const identity = serviceIdentity(projectRoot);
  return {
    ok: false,
    error: "MINDRAW_PROJECT_CONTEXT_MISMATCH",
    message: "Sidebar request belongs to a different Mindraw project canvas service. Reopen the sidebar for the active project.",
    service: identity,
    expectedProjectRootHash: identity.projectRootHash,
    receivedProjectRootHash: receivedProjectRootHash || null,
  };
}

function validateProjectContext({ req, url, body, projectRoot }) {
  const expectedProjectRootHash = projectRootHash(projectRoot);
  const receivedProjectRootHash = requestedProjectRootHash(req, url, body);
  return {
    ok: receivedProjectRootHash === expectedProjectRootHash,
    expectedProjectRootHash,
    receivedProjectRootHash,
  };
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isPathInsideDir(parentDir, targetPath) {
  const relativePath = relative(resolvePath(parentDir), resolvePath(targetPath));
  return relativePath === "" || (!relativePath.startsWith("..") && !relativePath.includes(".."));
}

function validateCanvasPathForProject({ projectRoot, canvasPath }) {
  const resolvedCanvasPath = resolvePath(canvasPath);
  const canvasDir = resolveCanvasDir(projectRoot);
  if (!resolvedCanvasPath.endsWith(".mindraw") || !isPathInsideDir(canvasDir, resolvedCanvasPath)) {
    return {
      ok: false,
      error: "MINDRAW_PROJECT_CANVAS_SCOPE_MISMATCH",
      message: "The selected canvas is not inside the active project's MindrawCanvas directory.",
      service: serviceIdentity(projectRoot),
      canvasPath: resolvedCanvasPath,
    };
  }
  return { ok: true, canvasPath: resolvedCanvasPath };
}

function htmlPage(state) {
  const status = state.status || "UNKNOWN";
  const selected = state.latestCanvas?.name || "No project canvas";
  const blocker = state.blockers?.[0]?.code || "";
  const projectContext = state.projectRootHash || projectRootHash(state.projectRoot);
  const projectLabel = state.projectLabel || projectRootLabel(state.projectRoot);
  const previewAvailable = state.ok === true && status === "READY" && state.preview?.available === true;
  const previewWidth = Number.isFinite(state.preview?.width) ? state.preview.width : 960;
  const previewHeight = Number.isFinite(state.preview?.height) ? state.preview.height : 540;
  const previewRevision = encodeURIComponent(String(state.preview?.revision ?? state.preview?.sha256 ?? state.preview?.byteLength ?? "initial"));
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Mindraw Project Canvas</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f6f7f8;
      color: #20242a;
      --border: #d7dce2;
      --muted: #4a525d;
      --surface: #ffffff;
      --canvas-bg: #edf1f4;
      --primary: #1f6feb;
    }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      grid-template-rows: auto 1fr auto;
      background: #f6f7f8;
    }
    header, footer {
      padding: 10px 12px;
      border-color: var(--border);
      border-style: solid;
      border-width: 0 0 1px;
      background: var(--surface);
    }
    footer {
      border-width: 1px 0 0;
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }
    h1 {
      margin: 0 0 4px;
      font-size: 15px;
      line-height: 1.25;
      font-weight: 650;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      font-size: 12px;
      color: var(--muted);
    }
    .pill {
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 2px 8px;
      background: #f9fafb;
      max-width: 100%;
      overflow-wrap: anywhere;
    }
    main {
      min-height: 0;
      display: grid;
      background: var(--canvas-bg);
    }
    #viewport {
      min-height: 0;
      overflow: hidden;
      cursor: grab;
      position: relative;
      touch-action: none;
      user-select: none;
    }
    #viewport.dragging {
      cursor: grabbing;
    }
    #stage {
      transform-origin: 0 0;
      position: absolute;
      left: 0;
      top: 0;
      will-change: transform;
    }
    #previewImage {
      display: block;
      max-width: none;
      max-height: none;
      box-shadow: 0 1px 12px rgba(18, 25, 38, 0.16);
      background: #fff;
      pointer-events: auto;
    }
    #loadingState {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      color: var(--muted);
      font-size: 13px;
      pointer-events: none;
    }
    #loadingState.hidden {
      display: none;
    }
    #emptyState {
      margin: auto;
      width: min(460px, calc(100vw - 32px));
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px;
      background: #fff;
      color: #2c333d;
      font-size: 13px;
      line-height: 1.45;
    }
    button {
      appearance: none;
      border: 1px solid #cbd2dc;
      border-radius: 7px;
      background: #fff;
      color: #20242a;
      min-height: 32px;
      padding: 0 10px;
      font: inherit;
      cursor: pointer;
    }
    button.primary {
      background: var(--primary);
      border-color: var(--primary);
      color: #fff;
    }
    #zoomLabel {
      align-self: center;
      min-width: 42px;
      text-align: center;
      font-size: 12px;
      color: var(--muted);
    }
    @media (prefers-color-scheme: dark) {
      :root, body { background: #111418; color: #edf1f5; }
      header, footer, #emptyState, button, .pill { background: #171b21; color: #edf1f5; border-color: #303742; }
      main { background: #0d1014; }
    }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(selected)}</h1>
	    <div class="meta">
	      <span id="statusPill" class="pill">${escapeHtml(status)}</span>
	      <span id="blockerPill" class="pill"${blocker ? "" : ` hidden`}>${escapeHtml(blocker)}</span>
	      <span id="projectPill" class="pill" title="${escapeHtml(projectLabel)}">Project ${escapeHtml(projectContext.slice(0, 8))}</span>
	    </div>
	  </header>
  <main>
    <div id="viewport" aria-label="Mindraw canvas preview">
      <div id="stage">
        ${
	          previewAvailable
	            ? `<img id="previewImage" src="/api/preview?project=${encodeURIComponent(projectContext)}&v=${previewRevision}" alt="Mindraw canvas preview" draggable="false" width="${previewWidth}" height="${previewHeight}" data-preview-width="${previewWidth}" data-preview-height="${previewHeight}" data-preview-revision="${escapeHtml(state.preview?.revision ?? "")}" />`
	            : `<div id="emptyState" role="status">${escapeHtml(blocker || "MINDRAW_PREVIEW_SOURCE_REQUIRED")}</div>`
	        }
      </div>
      ${previewAvailable ? `<div id="loadingState" role="status">Loading preview</div>` : ""}
    </div>
  </main>
  <footer>
    <button id="zoomOut" title="Zoom out">-</button>
    <button id="zoomIn" title="Zoom in">+</button>
    <span id="zoomLabel" aria-live="polite">Fit</span>
    <button id="reset" title="Reset view">Fit</button>
    <button id="refresh" title="Refresh preview">刷新</button>
    <span id="openStatus" class="pill" aria-live="polite">Ready</span>
    <button id="edit" class="primary">编辑</button>
  </footer>
  <script>
	    const viewport = document.getElementById("viewport");
	    const stage = document.getElementById("stage");
	    const projectContext = ${JSON.stringify(projectContext)};
	    let previewImage = document.getElementById("previewImage");
    let loadingState = document.getElementById("loadingState");
    const zoomLabel = document.getElementById("zoomLabel");
    const statusPill = document.getElementById("statusPill");
    const blockerPill = document.getElementById("blockerPill");
    const minScale = 0.2;
    const maxScale = 4;
    let fitScale = 1;
    let scale = 1;
    let x = 0;
    let y = 0;
    let active = false;
    let lastX = 0;
    let lastY = 0;
    let currentPreviewRevision = previewImage?.dataset.previewRevision || "";
    function previewSize() {
      if (!previewImage) return { width: 0, height: 0 };
      return {
        width: previewImage.naturalWidth || Number(previewImage.dataset.previewWidth || 960),
        height: previewImage.naturalHeight || Number(previewImage.dataset.previewHeight || 540)
      };
    }
    function setPreviewDimensions() {
      if (!previewImage) return;
      const size = previewSize();
      previewImage.style.width = size.width + "px";
      previewImage.style.height = size.height + "px";
    }
    function snapshot() {
      return {
        scale,
        fitScale,
        x,
        y,
        revision: currentPreviewRevision || null,
        previewSrc: previewImage?.getAttribute("src") || null,
        previewAvailable: Boolean(previewImage),
        loading: loadingState ? !loadingState.classList.contains("hidden") : false
      };
    }
    function render() {
      stage.style.transform = "translate(" + x + "px," + y + "px) scale(" + scale + ")";
      if (zoomLabel) zoomLabel.textContent = Math.round(scale * 100) + "%";
      window.__mindrawPreviewState = snapshot();
    }
	    function projectUrl(path, params = {}) {
	      const url = new URL(path, window.location.origin);
	      url.searchParams.set("project", projectContext);
	      for (const [key, value] of Object.entries(params)) {
	        if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
	      }
	      return url.pathname + url.search;
	    }
	    function previewUrl(revision) {
	      return projectUrl("/api/preview", { v: revision || String(Date.now()) });
    }
    function updateStateChrome(state) {
      if (statusPill) statusPill.textContent = state.status || "UNKNOWN";
      const blocker = state.blockers?.[0]?.code || "";
      if (blockerPill) {
        blockerPill.textContent = blocker;
        blockerPill.hidden = !blocker;
      }
    }
    function attachPreviewHandlers() {
      if (!previewImage) return;
      previewImage.addEventListener("load", () => {
        loadingState?.classList.add("hidden");
        fitToView();
      });
      if (previewImage.complete) {
        loadingState?.classList.add("hidden");
        fitToView();
      }
    }
    function showBlockedPreview(code) {
      document.getElementById("loadingState")?.remove();
      stage.innerHTML = '<div id="emptyState" role="status"></div>';
      const emptyState = document.getElementById("emptyState");
      if (emptyState) emptyState.textContent = code || "MINDRAW_PREVIEW_SOURCE_REQUIRED";
      previewImage = null;
      loadingState = null;
      currentPreviewRevision = "";
      render();
    }
    function installOrRefreshPreview(preview, force = false) {
      const revision = preview?.revision || preview?.sha256 || preview?.byteLength || String(Date.now());
      if (!previewImage) {
        stage.innerHTML = '<img id="previewImage" alt="Mindraw canvas preview" draggable="false" /><div id="loadingState" role="status">Loading preview</div>';
        previewImage = document.getElementById("previewImage");
        loadingState = document.getElementById("loadingState");
        attachPreviewHandlers();
      }
      previewImage.dataset.previewWidth = String(preview?.width || 960);
      previewImage.dataset.previewHeight = String(preview?.height || 540);
      previewImage.width = Number(preview?.width || 960);
      previewImage.height = Number(preview?.height || 540);
      setPreviewDimensions();
      if (force || revision !== currentPreviewRevision) {
        currentPreviewRevision = revision;
        previewImage.dataset.previewRevision = revision;
        loadingState?.classList.remove("hidden");
        previewImage.src = previewUrl(revision);
      }
      render();
    }
    async function refreshState(force = false) {
      try {
	        const response = await fetch(projectUrl("/api/state", { ts: Date.now() }), { cache: "no-store" });
        const state = await response.json();
        updateStateChrome(state);
        if (state.ok === true && state.status === "READY" && state.preview?.available === true) {
          installOrRefreshPreview(state.preview, force);
        } else {
          showBlockedPreview(state.blockers?.[0]?.code || state.status || "MINDRAW_PREVIEW_SOURCE_REQUIRED");
        }
        window.__mindrawLastStateRefresh = { ok: true, status: state.status, revision: state.preview?.revision || null };
      } catch (error) {
        window.__mindrawLastStateRefresh = { ok: false, error: error?.message || "STATE_REFRESH_FAILED" };
      }
    }
    function fitToView() {
      if (!previewImage) {
        render();
        return;
      }
      setPreviewDimensions();
      const viewportBox = viewport.getBoundingClientRect();
      const size = previewSize();
      const padding = 24;
      const availableWidth = Math.max(1, viewportBox.width - padding);
      const availableHeight = Math.max(1, viewportBox.height - padding);
      fitScale = Math.max(minScale, Math.min(1, availableWidth / size.width, availableHeight / size.height));
      scale = fitScale;
      x = Math.round((viewportBox.width - size.width * scale) / 2);
      y = Math.round((viewportBox.height - size.height * scale) / 2);
      render();
    }
    function zoom(delta, originX = viewport.clientWidth / 2, originY = viewport.clientHeight / 2) {
      const nextScale = Math.min(maxScale, Math.max(minScale, scale + delta));
      const ratio = nextScale / scale;
      x = originX - (originX - x) * ratio;
      y = originY - (originY - y) * ratio;
      scale = nextScale;
      render();
    }
    viewport.addEventListener("pointerdown", (event) => {
      if (!previewImage) return;
      active = true;
      lastX = event.clientX;
      lastY = event.clientY;
      viewport.classList.add("dragging");
      viewport.setPointerCapture(event.pointerId);
    });
    viewport.addEventListener("pointermove", (event) => {
      if (!active) return;
      x += event.clientX - lastX;
      y += event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
      render();
    });
    viewport.addEventListener("pointerup", () => {
      active = false;
      viewport.classList.remove("dragging");
    });
    viewport.addEventListener("wheel", (event) => {
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      zoom(event.deltaY > 0 ? -0.1 : 0.1, event.clientX - rect.left, event.clientY - rect.top);
    }, { passive: false });
    document.getElementById("zoomOut").addEventListener("click", () => zoom(-0.1));
    document.getElementById("zoomIn").addEventListener("click", () => zoom(0.1));
    document.getElementById("reset").addEventListener("click", fitToView);
    document.getElementById("refresh").addEventListener("click", () => refreshState(true));
    async function openEdit(source) {
      const openStatus = document.getElementById("openStatus");
      if (openStatus) openStatus.textContent = "Opening Mindraw";
      window.__mindrawOpenEditState = { ok: false, source, status: "opening" };
      try {
        const response = await fetch("/api/open-edit", {
	          method: "POST",
	          headers: { "content-type": "application/json" },
	          body: JSON.stringify({ source, projectRootHash: projectContext })
	        });
        const payload = await response.json();
        if (!response.ok || payload.ok !== true || payload.opened?.opened !== true) {
          throw new Error(payload.error || payload.opened?.error || "MINDRAW_OPEN_PACKAGE_API_REQUIRED");
        }
        const focusConfirmed = payload.opened?.focusConfirmed === true || payload.opened?.frontmost === true || payload.opened?.activated === true || payload.opened?.activation?.frontmost === true || payload.opened?.focus?.frontmost === true;
        const statusText = focusConfirmed
          ? "Mindraw opened and focused"
          : "Mindraw opened. If not visible, switch to Mindraw or check other Spaces.";
        if (openStatus) openStatus.textContent = statusText;
        window.__mindrawOpenEditState = {
          ok: true,
          source,
          status: "opened",
          statusText,
          method: payload.opened?.method,
          fallbackUsed: payload.opened?.fallbackUsed === true,
          focusConfirmed,
          userActionRequired: !focusConfirmed
        };
        setTimeout(() => refreshState(false), 750);
      } catch (error) {
        const code = error?.message || "MINDRAW_OPEN_PACKAGE_API_REQUIRED";
        if (openStatus) openStatus.textContent = code;
        window.__mindrawOpenEditState = { ok: false, source, status: "failed", error: code };
      }
    }
    document.getElementById("edit").addEventListener("click", () => {
      openEdit("button");
    });
    viewport.addEventListener("dblclick", () => {
      openEdit("double-click");
    });
    if (previewImage) {
      attachPreviewHandlers();
      setInterval(() => refreshState(false), 2000);
    } else {
      render();
      setInterval(() => refreshState(false), 2000);
    }
    window.addEventListener("resize", fitToView);
    window.__mindrawRefreshNow = refreshState;
  </script>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function createPreviewServer({ projectRoot, capabilityPath, launchFallbackCommand }) {
  const serviceProjectRoot = await canonicalizeProjectRoot(projectRoot);
  let state = await inspectProjectCanvas({ projectRoot: serviceProjectRoot, createNew: false, capabilityPath, launchFallbackCommand });
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      const body = req.method === "POST" ? await readJsonBody(req) : {};
      if (url.pathname === "/") {
        state = await inspectProjectCanvas({ projectRoot: serviceProjectRoot, createNew: false, capabilityPath, launchFallbackCommand });
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        res.end(htmlPage(publicPreviewState(state, serviceProjectRoot)));
        return;
      }
      if (url.pathname === "/api/identity") {
        sendJson(res, 200, { ok: true, ...serviceIdentity(serviceProjectRoot) });
        return;
      }
      if (url.pathname === "/api/state") {
        const context = validateProjectContext({ req, url, body, projectRoot: serviceProjectRoot });
        if (!context.ok) {
          sendJson(res, 409, projectContextMismatchPayload({ projectRoot: serviceProjectRoot, receivedProjectRootHash: context.receivedProjectRootHash }));
          return;
        }
        state = await inspectProjectCanvas({ projectRoot: serviceProjectRoot, createNew: false, capabilityPath, launchFallbackCommand });
        sendJson(res, 200, publicPreviewState(state, serviceProjectRoot));
        return;
      }
      if (url.pathname === "/api/preview") {
        const context = validateProjectContext({ req, url, body, projectRoot: serviceProjectRoot });
        if (!context.ok) {
          sendJson(res, 409, projectContextMismatchPayload({ projectRoot: serviceProjectRoot, receivedProjectRootHash: context.receivedProjectRootHash }));
          return;
        }
        state = await inspectProjectCanvas({ projectRoot: serviceProjectRoot, createNew: false, capabilityPath, launchFallbackCommand });
        if (state.ok !== true || state.status !== "READY" || state.preview?.available !== true || !state.preview?.artifactPath) {
          sendJson(res, 409, {
            ok: false,
            error: state.blockers?.[0]?.code || "MINDRAW_PREVIEW_SOURCE_REQUIRED",
            state: publicPreviewState(state, serviceProjectRoot),
          });
          return;
        }
        const artifact = await stat(state.preview.artifactPath);
        res.writeHead(200, {
          "content-type": state.preview.mimeType,
          "content-length": artifact.size,
          "cache-control": "no-store"
        });
        const { createReadStream } = await import("node:fs");
        createReadStream(state.preview.artifactPath).pipe(res);
        return;
      }
      if (url.pathname === "/api/open-edit" && req.method === "POST") {
        const context = validateProjectContext({ req, url, body, projectRoot: serviceProjectRoot });
        if (!context.ok) {
          sendJson(res, 409, projectContextMismatchPayload({ projectRoot: serviceProjectRoot, receivedProjectRootHash: context.receivedProjectRootHash }));
          return;
        }
        try {
          state = await inspectProjectCanvas({ projectRoot: serviceProjectRoot, createNew: false, capabilityPath, launchFallbackCommand });
        } catch (error) {
          if (!state?.latestCanvas?.path) throw error;
        }
        const canvasPath = state.latestCanvas?.path;
        if (!canvasPath) {
          sendJson(res, 409, {
            ok: false,
            error: state.blockers?.[0]?.code || "CANVAS_PATH_REQUIRED",
            state: publicPreviewState(state, serviceProjectRoot),
          });
          return;
        }
        const scopedCanvas = validateCanvasPathForProject({ projectRoot: serviceProjectRoot, canvasPath });
        if (!scopedCanvas.ok) {
          sendJson(res, 409, scopedCanvas);
          return;
        }
        const opened = await openCanvasInMindraw({ canvasPath: scopedCanvas.canvasPath, capabilityPath, launchFallbackCommand });
        sendJson(res, 200, { ok: true, opened, service: serviceIdentity(serviceProjectRoot) });
        return;
      }
      sendJson(res, 404, { ok: false, error: "NOT_FOUND" });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.code || "INTERNAL_ERROR", message: error.message });
    }
  });
  return { server, getState: () => state };
}

function normalizePort(value) {
  const port = Number(value || defaultCanvasPort);
  if (!Number.isInteger(port) || port < 0 || port > 65535) return defaultCanvasPort;
  return port;
}

function candidatePorts(preferredPort) {
  const preferred = normalizePort(preferredPort);
  if (preferred === 0) return [0];
  const ports = [];
  for (let offset = 0; offset < maxPortSearchAttempts; offset += 1) {
    const port = preferred + offset;
    if (port > 65535) break;
    ports.push(port);
  }
  return ports;
}

function isTcpPortOpen(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const finish = (open) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(portProbeTimeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function fetchJsonWithTimeout(url, timeoutMs = portProbeTimeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function probeExistingPreviewService(port, projectRoot) {
  if (port === 0) return { occupied: false, port };
  const occupied = await isTcpPortOpen(port);
  if (!occupied) return { occupied: false, port };
  const baseUrl = `http://127.0.0.1:${port}`;
  const identity = await fetchJsonWithTimeout(`${baseUrl}/api/identity`);
  if (identity?.service === "mindraw-canvas-service") {
    return { occupied: true, recognized: true, port, identity };
  }
  const legacyState = await fetchJsonWithTimeout(withProjectContext(`${baseUrl}/api/state`, projectRoot));
  if (typeof legacyState?.projectRoot === "string") {
    return {
      occupied: true,
      recognized: true,
      legacy: true,
      port,
      identity: {
        service: "mindraw-canvas-service",
        protocolVersion: 1,
        projectRoot: resolveProjectRoot(legacyState.projectRoot),
        projectRootHash: projectRootHash(legacyState.projectRoot),
        projectLabel: projectRootLabel(legacyState.projectRoot),
        canvasDir: legacyState.canvasDir || resolveCanvasDir(legacyState.projectRoot),
      },
    };
  }
  return { occupied: true, recognized: false, port };
}

function existingServiceMatchesProject(probe, projectRoot) {
  const resolvedProjectRoot = resolveProjectRoot(projectRoot);
  return (
    probe?.identity?.projectRootHash === projectRootHash(resolvedProjectRoot) ||
    (typeof probe?.identity?.projectRoot === "string" && resolveProjectRoot(probe.identity.projectRoot) === resolvedProjectRoot)
  );
}

async function listenServer(server, port) {
  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

async function startProjectScopedPreviewService({ projectRoot, capabilityPath, launchFallbackCommand, preferredPort }) {
  const resolvedProjectRoot = await canonicalizeProjectRoot(projectRoot);
  const skippedPorts = [];
  for (const port of candidatePorts(preferredPort)) {
    const probe = await probeExistingPreviewService(port, resolvedProjectRoot);
    const baseUrl = `http://127.0.0.1:${port}`;
    if (probe.occupied && existingServiceMatchesProject(probe, resolvedProjectRoot)) {
      const url = withProjectContext(baseUrl, resolvedProjectRoot);
      const existingState =
        (await fetchJsonWithTimeout(withProjectContext(`${baseUrl}/api/state`, resolvedProjectRoot))) ||
        { projectRoot: resolvedProjectRoot, canvasDir: resolveCanvasDir(resolvedProjectRoot), status: "RUNNING", blockers: [] };
      return {
        reused: true,
        url,
        port,
        state: existingState,
        service: probe.identity,
        portSelection: { preferredPort: normalizePort(preferredPort), selectedPort: port, reusedExisting: true, skippedPorts },
      };
    }
    if (probe.occupied) {
      skippedPorts.push({
        port,
        reason: probe.recognized ? "PROJECT_CONTEXT_MISMATCH" : "PORT_OCCUPIED_BY_UNKNOWN_SERVICE",
        projectRootHash: probe.identity?.projectRootHash || null,
      });
      continue;
    }
    const { server, getState } = await createPreviewServer({ projectRoot: resolvedProjectRoot, capabilityPath, launchFallbackCommand });
    try {
      await listenServer(server, port);
    } catch (error) {
      await new Promise((resolve) => server.close(resolve)).catch(() => {});
      if (error?.code === "EADDRINUSE") {
        skippedPorts.push({ port, reason: "EADDRINUSE_RACE", projectRootHash: null });
        continue;
      }
      throw error;
    }
    const address = server.address();
    const selectedPort = address.port;
    const url = withProjectContext(`http://127.0.0.1:${selectedPort}`, resolvedProjectRoot);
    const state = await getState();
    return {
      reused: false,
      url,
      port: selectedPort,
      server,
      state,
      service: serviceIdentity(resolvedProjectRoot),
      portSelection: { preferredPort: normalizePort(preferredPort), selectedPort, reusedExisting: false, skippedPorts },
    };
  }
  throw new Error(`No project-scoped Mindraw canvas service port is available near ${normalizePort(preferredPort)}.`);
}

function printServeResult(result, projectRoot) {
  const state = result.state || {};
  const resolvedProjectRoot = resolveProjectRoot(state.projectRoot || projectRoot);
  console.log(`Mindraw project canvas: ${result.url}`);
  console.log(`Mindraw project root: ${resolvedProjectRoot}`);
  console.log(`Mindraw canvas directory: ${state.canvasDir || resolveCanvasDir(resolvedProjectRoot)}`);
  if (result.reused) {
    console.log("Mindraw project service: reused existing project-scoped service");
  }
  console.log(stableJson({
    ok: true,
    url: result.url,
    projectRoot: resolvedProjectRoot,
    projectRootHash: projectRootHash(resolvedProjectRoot),
    canvasDir: state.canvasDir || resolveCanvasDir(resolvedProjectRoot),
    status: state.status || "RUNNING",
    blockers: state.blockers || [],
    reusedExistingService: result.reused === true,
    portSelection: result.portSelection,
  }));
}

async function serve(args) {
  const projectRoot = args["project-root"] || process.cwd();
  const port = normalizePort(args.port || process.env.MINDRAW_CANVAS_PORT || defaultCanvasPort);
  const capabilityPath = args.capability || process.env.MINDRAW_RUNTIME_CAPABILITY_PATH;
  const result = await startProjectScopedPreviewService({ projectRoot, capabilityPath, preferredPort: port });
  printServeResult(result, projectRoot);
}

async function startMockMindrawRuntime(root, options = {}) {
  const token = "m4c-mcpe-02-mock-token";
  const calls = [];
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      if (url.pathname === "/health") {
        sendJson(res, 200, { ok: true });
        return;
      }
      if (url.pathname !== "/rpc" || req.method !== "POST") {
        sendJson(res, 404, { ok: false, error: "NOT_FOUND" });
        return;
      }
      const chunks = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      calls.push({ method: request.method, params: request.params });
      const packagePath = request.params?.packagePath;
      if (request.method === "mindraw.app.create_blank_package") {
        if (!packagePath) throw new Error("packagePath required");
        if (existsSync(packagePath)) {
          sendJson(res, 200, {
            jsonrpc: "2.0",
            id: request.id,
            error: { code: "CANVAS_TARGET_ALREADY_EXISTS", message: "Target exists." }
          });
          return;
        }
        const previewDir = join(packagePath, "preview");
        await mkdir(previewDir, { recursive: true });
        const artifactPath = join(previewDir, "preview.svg");
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"><rect width="960" height="540" fill="#ffffff"/><rect x="16" y="16" width="48" height="48" fill="#2563eb"/><rect x="456" y="246" width="64" height="48" fill="#22c55e"/><rect x="888" y="468" width="48" height="48" fill="#f97316"/><text x="48" y="96" font-size="36">Mindraw Project Canvas</text><text x="48" y="152" font-size="22">${escapeHtml(packagePath.split("/").at(-1))}</text></svg>\n`;
        await writeFile(artifactPath, svg, "utf8");
        sendJson(res, 200, {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            packagePath,
            documentId: `mock_${packagePath.split("/").at(-1)?.replace(/[^a-zA-Z0-9]/g, "_")}`,
            created: true,
            overwritten: false,
            previewSnapshot: {
              artifactPath,
              mimeType: "image/svg+xml",
              width: 960,
              height: 540,
              byteLength: Buffer.byteLength(svg),
              sha256: "mock-preview-sha256",
              source: "mindraw-full-canvas-svg-preview-v1",
              bytesIncluded: false
            }
          }
        });
        return;
      }
      if (request.method === "mindraw.app.get_preview_snapshot") {
        if (options.previewSourceRequired === true) {
          sendJson(res, 200, {
            jsonrpc: "2.0",
            id: request.id,
            error: { code: "MINDRAW_PREVIEW_SOURCE_REQUIRED", message: "Mindraw preview source is not fresh or reachable." }
          });
          return;
        }
        const artifactPath = join(packagePath, "preview", "preview.svg");
        const artifact = await stat(artifactPath);
        sendJson(res, 200, {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            previewSnapshot: {
              artifactPath,
              mimeType: "image/svg+xml",
              width: 960,
              height: 540,
              byteLength: artifact.size,
              sha256: "mock-preview-sha256",
              source: "mindraw-full-canvas-svg-preview-v1",
              bytesIncluded: false
            }
          }
        });
        return;
      }
      if (request.method === "mindraw.app.open_package") {
        sendJson(res, 200, {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            packagePath,
            opened: true,
            documentId: `mock_${packagePath?.split("/").at(-1)?.replace(/[^a-zA-Z0-9]/g, "_")}`
          }
        });
        return;
      }
      sendJson(res, 200, { jsonrpc: "2.0", id: request.id, error: { code: "METHOD_NOT_FOUND", message: request.method } });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: "MOCK_RUNTIME_ERROR", message: error.message });
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const endpoint = `http://127.0.0.1:${address.port}/rpc`;
  const capabilityPath = join(root, "mock-write-api.json");
  await writeFile(
    capabilityPath,
    stableJson({
      pid: process.pid,
      endpoint,
      healthEndpoint: `http://127.0.0.1:${address.port}/health`,
      token,
      capabilities: {
        createBlankPackage: "write",
        previewSnapshot: "read",
        openPackage: "write",
        deepLinkOpen: "open",
        targetFramePixelPayload: "read"
      },
      methods: [
        "mindraw.app.create_blank_package",
        "mindraw.app.get_preview_snapshot",
        "mindraw.app.open_package",
        "mindraw.app.get_target_frame_pixel_payload"
      ]
    }),
    "utf8"
  );
  return { server, capabilityPath, calls };
}

async function writeMockOpenCommand(root, options = {}) {
  const commandPath = join(root, "mock-open-command.mjs");
  const copyCapabilityFrom = options.copyCapabilityFrom ? String(options.copyCapabilityFrom) : "";
  const copyCapabilityTo = options.copyCapabilityTo ? String(options.copyCapabilityTo) : "";
  const script = `#!/usr/bin/env node
import { copyFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const copyCapabilityFrom = ${JSON.stringify(copyCapabilityFrom)};
const copyCapabilityTo = ${JSON.stringify(copyCapabilityTo)};
if (copyCapabilityFrom && copyCapabilityTo) {
  await mkdir(dirname(copyCapabilityTo), { recursive: true });
  await copyFile(copyCapabilityFrom, copyCapabilityTo);
}
process.exit(0);
`;
  await writeFile(commandPath, script, "utf8");
  await chmod(commandPath, 0o755);
  return commandPath;
}

async function runMcpStdio({ projectRoot, capabilityPath }) {
  const serverPath = join(dirname(new URL(import.meta.url).pathname), "../mcp/server.mjs");
  const messages = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "inspect_mindraw_project_canvas",
        arguments: { projectRoot }
      }
    },
    {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "open_mindraw_project_canvas",
        arguments: { projectRoot, dryRunOpen: true }
      }
    }
  ];
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, MINDRAW_RUNTIME_CAPABILITY_PATH: capabilityPath },
    stdio: ["pipe", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  const timeout = setTimeout(() => child.kill("SIGTERM"), 5000);
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.stdin.end(`${messages.map((message) => JSON.stringify(message)).join("\n")}\n`);
  const exit = await new Promise((resolve) => {
    child.on("close", (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timeout);
  const responses = parseJsonObjectsFromStream(stdout);
  return { exit, responses, stderr };
}

function parseJsonObjectsFromStream(streamText) {
  const objects = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < streamText.length; index += 1) {
    const char = streamText[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        objects.push(JSON.parse(streamText.slice(start, index + 1)));
        start = -1;
      }
    }
  }
  return objects;
}

async function mcpSmoke(args) {
  const root = await mkdtemp(join(tmpdir(), "mindraw-plugin-mcp-smoke-"));
  const mockRuntime = await startMockMindrawRuntime(root);
  const report = {
    ok: false,
    checks: [],
    redaction: {
      tokenIncluded: false,
      endpointIncluded: false,
      runtimePathIncluded: false,
      rawPreviewBytesIncluded: false,
      rawDataUrlIncluded: false
    }
  };
  try {
    const result = await runMcpStdio({ projectRoot: root, capabilityPath: mockRuntime.capabilityPath });
    const tools = result.responses.find((response) => response.id === 2)?.result?.tools ?? [];
    const inspectText = result.responses.find((response) => response.id === 3)?.result?.content?.[0]?.text ?? "{}";
    const openText = result.responses.find((response) => response.id === 4)?.result?.content?.[0]?.text ?? "{}";
    const inspectPayload = JSON.parse(inspectText);
    const openPayload = JSON.parse(openText);
    report.checks.push({
      name: "MCP stdio lists Mindraw project canvas tools",
      ok: result.exit.code === 0 && tools.some((tool) => tool.name === "inspect_mindraw_project_canvas") && tools.some((tool) => tool.name === "open_mindraw_project_canvas"),
      toolNames: tools.map((tool) => tool.name)
    });
    report.checks.push({
      name: "MCP inspect creates or finds project canvas through Mindraw create API",
      ok: inspectPayload.ok === true && inspectPayload.state?.status === "READY" && inspectPayload.state?.latestCanvas?.name?.endsWith("-01.mindraw"),
      state: inspectPayload.state
    });
    report.checks.push({
      name: "MCP open dry-run uses Mindraw openPackage without fallback",
      ok: openPayload.ok === true && openPayload.opened?.method === "mindraw.app.open_package" && openPayload.opened?.fallbackUsed === false,
      opened: openPayload.opened
    });
    const serialized = stableJson(report);
    report.redaction = {
      tokenIncluded: serialized.includes("m4c-mcpe-02-mock-token"),
      endpointIncluded: /127\.0\.0\.1:\d+/u.test(serialized),
      runtimePathIncluded: serialized.includes("write-api.json") || serialized.includes("mock-write-api.json"),
      rawPreviewBytesIncluded: serialized.includes("<svg"),
      rawDataUrlIncluded: serialized.includes("data:image") || serialized.includes("base64,")
    };
    report.checks.push({
      name: "MCP smoke report omits token, endpoint, runtime path, raw preview bytes, and dataURL",
      ok: Object.values(report.redaction).every((value) => value === false),
      redaction: report.redaction
    });
    report.ok = report.checks.every((check) => check.ok === true);
    if (args.report) {
      await mkdir(dirname(args.report), { recursive: true });
      await writeFile(args.report, stableJson(report), "utf8");
    }
    console.log(stableJson(report));
  } finally {
    await new Promise((resolve) => mockRuntime.server.close(resolve));
    if (!args.keep) {
      await rm(root, { recursive: true, force: true });
    }
  }
}

async function httpSmoke(args) {
  const root = await mkdtemp(join(tmpdir(), "mindraw-plugin-http-smoke-"));
  const mockRuntime = await startMockMindrawRuntime(root);
  const blockedRuntimeRoot = join(root, "blocked-runtime");
  await mkdir(blockedRuntimeRoot, { recursive: true });
  const blockedRuntime = await startMockMindrawRuntime(blockedRuntimeRoot, { previewSourceRequired: true });
  const { server } = await createPreviewServer({ projectRoot: root, capabilityPath: mockRuntime.capabilityPath });
  const blockedRoot = join(root, "project-preview-source-required");
  let blockedServer = null;
  let fallbackServer = null;
  let createBootstrapServer = null;
  let createBootstrapGetState = null;
  const report = {
    ok: false,
    checks: [],
    redaction: {
      tokenIncluded: false,
      endpointIncluded: false,
      runtimePathIncluded: false,
      rawPreviewBytesIncluded: false,
      rawDataUrlIncluded: false
    }
  };
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
	    const address = server.address();
	    const baseUrl = `http://127.0.0.1:${address.port}`;
	    const identity = await fetch(`${baseUrl}/api/identity`).then((response) => response.json());
	    const serviceProjectRoot = identity.projectRoot || root;
	    const html = await fetch(`${baseUrl}/`).then((response) => response.text());
	    const state = await fetch(withProjectContext(`${baseUrl}/api/state`, serviceProjectRoot)).then((response) => response.json());
	    const previewResponse = await fetch(withProjectContext(`${baseUrl}/api/preview`, serviceProjectRoot));
	    const previewBody = await previewResponse.text();
	    const openResult = await fetch(withProjectContext(`${baseUrl}/api/open-edit`, serviceProjectRoot), {
	      method: "POST",
	      headers: { "content-type": "application/json" },
	      body: JSON.stringify({ projectRootHash: projectRootHash(serviceProjectRoot), source: "http-smoke" }),
	    }).then((response) => response.json());
    report.checks.push({
      name: "sidebar HTML exposes read-only preview controls",
      ok:
        html.includes('id="previewImage"') &&
        html.includes('id="zoomOut"') &&
        html.includes('id="zoomIn"') &&
        html.includes('id="zoomLabel"') &&
        html.includes('id="reset"') &&
        html.includes('id="refresh"') &&
	        html.includes('id="edit"') &&
	        html.includes('id="openStatus"') &&
	        html.includes('id="projectPill"') &&
	        html.includes("__mindrawRefreshNow") &&
	        html.includes("/api/preview?project=") &&
	        html.includes("fitToView") &&
	        html.includes("dblclick"),
	      controls: ["previewImage", "zoomOut", "zoomIn", "zoomLabel", "reset", "refresh", "edit", "openStatus", "projectPill", "fitToView", "dblclick", "state-poll"]
    });
    report.checks.push({
      name: "/api/state returns sanitized READY project canvas state",
      ok: state.status === "READY" && state.preview?.available === true && state.preview?.artifactPath === "<local-preview-artifact>" && typeof state.preview?.revision === "string",
      state
    });
    report.checks.push({
      name: "/api/preview streams full preview artifact without exposing dataURL in JSON",
      ok: previewResponse.ok && previewResponse.headers.get("content-type")?.startsWith("image/svg+xml") && previewBody.includes("<svg"),
      preview: {
        contentType: previewResponse.headers.get("content-type"),
        byteLength: Number(previewResponse.headers.get("content-length") ?? previewBody.length),
        bodyPersistedInReport: false
      }
    });
	    report.checks.push({
	      name: "edit and double-click endpoint uses Mindraw openPackage",
	      ok:
	        openResult.ok === true &&
	        openResult.opened?.method === "mindraw.app.open_package" &&
	        openResult.opened?.fallbackUsed === false &&
	        openResult.opened?.canvasPath === state.latestCanvas?.path,
	      opened: openResult.opened
	    });
	    const otherProjectRoot = join(root, "other-project");
	    await mkdir(otherProjectRoot, { recursive: true });
	    const mismatchResponse = await fetch(withProjectContext(`${baseUrl}/api/open-edit`, otherProjectRoot), {
	      method: "POST",
	      headers: { "content-type": "application/json" },
	      body: JSON.stringify({ projectRootHash: projectRootHash(otherProjectRoot), source: "http-smoke-mismatch" }),
	    });
	    const mismatchPayload = await mismatchResponse.json();
	    report.checks.push({
	      name: "open-edit fails closed when sidebar project context does not match the service project",
	      ok: mismatchResponse.status === 409 && mismatchPayload.error === "MINDRAW_PROJECT_CONTEXT_MISMATCH",
	      mismatch: {
	        httpStatus: mismatchResponse.status,
	        error: mismatchPayload.error,
	        expectedProjectRootHash: mismatchPayload.expectedProjectRootHash,
	        receivedProjectRootHash: mismatchPayload.receivedProjectRootHash,
	      },
	    });
	    const mutation = await mutateLatestPreviewArtifact({ projectRoot: root, capabilityPath: mockRuntime.capabilityPath, label: "http-smoke" });
	    const refreshedState = await fetch(withProjectContext(`${baseUrl}/api/state`, serviceProjectRoot, { ts: Date.now() }), { cache: "no-store" }).then((response) => response.json());
	    const refreshedPreviewResponse = await fetch(withProjectContext(`${baseUrl}/api/preview`, serviceProjectRoot, { v: refreshedState.preview?.revision ?? "missing" }), { cache: "no-store" });
    report.checks.push({
      name: "state refresh detects preview artifact revision changes for cache busting",
      ok:
        state.preview?.revision !== refreshedState.preview?.revision &&
        mutation.previousRevision !== refreshedState.preview?.revision &&
        refreshedState.status === "READY" &&
        refreshedPreviewResponse.ok === true &&
        refreshedPreviewResponse.headers.get("cache-control") === "no-store",
      beforeRevision: state.preview?.revision,
      afterRevision: refreshedState.preview?.revision,
      refreshedContentType: refreshedPreviewResponse.headers.get("content-type"),
    });
    await mkdir(blockedRoot, { recursive: true });
    const seedBlocked = await inspectProjectCanvas({ projectRoot: blockedRoot, createNew: false, capabilityPath: mockRuntime.capabilityPath });
    ({ server: blockedServer } = await createPreviewServer({ projectRoot: blockedRoot, capabilityPath: blockedRuntime.capabilityPath }));
    await new Promise((resolve, reject) => {
      blockedServer.once("error", reject);
      blockedServer.listen(0, "127.0.0.1", resolve);
	    });
	    const blockedBaseUrl = `http://127.0.0.1:${blockedServer.address().port}`;
	    const blockedIdentity = await fetch(`${blockedBaseUrl}/api/identity`).then((response) => response.json());
	    const blockedServiceProjectRoot = blockedIdentity.projectRoot || blockedRoot;
	    const blockedHtml = await fetch(`${blockedBaseUrl}/`).then((response) => response.text());
	    const blockedState = await fetch(withProjectContext(`${blockedBaseUrl}/api/state`, blockedServiceProjectRoot)).then((response) => response.json());
	    const blockedPreviewResponse = await fetch(withProjectContext(`${blockedBaseUrl}/api/preview`, blockedServiceProjectRoot));
	    const blockedPreviewPayload = await blockedPreviewResponse.json();
    report.checks.push({
      name: "preview source-required state fails closed without READY or stale image",
      ok:
	        seedBlocked.status === "READY" &&
	        blockedState.status === "BLOCKED_MINDRAW_PREVIEW_SOURCE_REQUIRED" &&
	        blockedState.blockers?.some((item) => item.code === "MINDRAW_PREVIEW_SOURCE_REQUIRED") &&
	        !blockedHtml.includes('src="/api/preview?') &&
	        blockedHtml.includes('id="emptyState"') &&
        blockedHtml.includes("MINDRAW_PREVIEW_SOURCE_REQUIRED") &&
        blockedPreviewResponse.status === 409 &&
        blockedPreviewPayload.error === "MINDRAW_PREVIEW_SOURCE_REQUIRED",
      state: blockedState,
      previewHttpStatus: blockedPreviewResponse.status,
      previewPayload: blockedPreviewPayload,
    });

    const fallbackRoot = join(root, "project-open-fallback");
    const fallbackCanvasPath = join(fallbackRoot, "MindrawCanvas", `${currentSmokeDatePrefix()}01.mindraw`);
    await mkdir(fallbackCanvasPath, { recursive: true });
    const mockOpenCommand = await writeMockOpenCommand(root);
    ({ server: fallbackServer } = await createPreviewServer({
      projectRoot: fallbackRoot,
      capabilityPath: join(root, "missing-write-api.json"),
      launchFallbackCommand: mockOpenCommand,
    }));
    await new Promise((resolve, reject) => {
      fallbackServer.once("error", reject);
      fallbackServer.listen(0, "127.0.0.1", resolve);
	    });
	    const fallbackBaseUrl = `http://127.0.0.1:${fallbackServer.address().port}`;
	    const fallbackIdentity = await fetch(`${fallbackBaseUrl}/api/identity`).then((response) => response.json());
	    const fallbackServiceProjectRoot = fallbackIdentity.projectRoot || fallbackRoot;
	    const fallbackState = await fetch(withProjectContext(`${fallbackBaseUrl}/api/state`, fallbackServiceProjectRoot)).then((response) => response.json());
	    const fallbackOpenResult = await fetch(withProjectContext(`${fallbackBaseUrl}/api/open-edit`, fallbackServiceProjectRoot), {
	      method: "POST",
	      headers: { "content-type": "application/json" },
	      body: JSON.stringify({ projectRootHash: projectRootHash(fallbackServiceProjectRoot), source: "http-smoke" }),
	    }).then((response) => response.json());
    const expectedMacFallback =
      fallbackState.status === "BLOCKED_MINDRAW_PREVIEW_SOURCE_REQUIRED" &&
      fallbackOpenResult.ok === true &&
      fallbackOpenResult.opened?.opened === true &&
      fallbackOpenResult.opened?.fallbackUsed === true &&
      fallbackOpenResult.opened?.method === "macos.open.bundle" &&
      fallbackOpenResult.opened?.fallbackReason?.code === "MINDRAW_OPEN_PACKAGE_API_REQUIRED" &&
      fallbackOpenResult.opened?.fallbackReason?.reason === "CAPABILITY_FILE_NOT_FOUND" &&
      fallbackOpenResult.opened?.canvasPath === fallbackState.latestCanvas?.path;
    report.checks.push({
      name: "edit endpoint uses macOS launch fallback when openPackage capability is unavailable",
      ok: process.platform === "darwin" ? expectedMacFallback : fallbackOpenResult.ok === false && fallbackOpenResult.error === "MINDRAW_OPEN_PACKAGE_API_REQUIRED",
      state: fallbackState,
      opened: fallbackOpenResult.opened,
    });

    const createBootstrapRoot = join(root, "project-create-bootstrap");
    const createBootstrapCapabilityPath = join(root, "create-bootstrap-runtime", "write-api.json");
    await mkdir(createBootstrapRoot, { recursive: true });
    const createBootstrapOpenCommand = await writeMockOpenCommand(root, {
      copyCapabilityFrom: mockRuntime.capabilityPath,
      copyCapabilityTo: createBootstrapCapabilityPath,
    });
    ({ server: createBootstrapServer, getState: createBootstrapGetState } = await createPreviewServer({
      projectRoot: createBootstrapRoot,
      capabilityPath: createBootstrapCapabilityPath,
      launchFallbackCommand: createBootstrapOpenCommand,
    }));
    await new Promise((resolve, reject) => {
      createBootstrapServer.once("error", reject);
      createBootstrapServer.listen(0, "127.0.0.1", resolve);
	    });
	    const createBootstrapBaseUrl = `http://127.0.0.1:${createBootstrapServer.address().port}`;
	    const createBootstrapIdentity = await fetch(`${createBootstrapBaseUrl}/api/identity`).then((response) => response.json());
	    const createBootstrapServiceProjectRoot = createBootstrapIdentity.projectRoot || createBootstrapRoot;
	    const createBootstrapInitialState = publicState(await createBootstrapGetState());
	    const createBootstrapState = await fetch(withProjectContext(`${createBootstrapBaseUrl}/api/state`, createBootstrapServiceProjectRoot)).then((response) => response.json());
	    const createBootstrapPreviewResponse = await fetch(withProjectContext(`${createBootstrapBaseUrl}/api/preview`, createBootstrapServiceProjectRoot));
    const expectedCreateBootstrap =
      createBootstrapInitialState.status === "READY" &&
      createBootstrapState.status === "READY" &&
      createBootstrapState.latestCanvas?.name?.endsWith("-01.mindraw") &&
      createBootstrapInitialState.createResult?.created === true &&
      createBootstrapInitialState.createResult?.bootstrap?.fallbackUsed === true &&
      createBootstrapInitialState.createResult?.bootstrap?.method === "macos.open.bundle.app" &&
      createBootstrapInitialState.createResult?.bootstrap?.fallbackReason?.code === "MINDRAW_CANVAS_CREATE_API_REQUIRED" &&
      createBootstrapInitialState.createResult?.bootstrap?.fallbackReason?.reason === "CAPABILITY_FILE_NOT_FOUND" &&
      createBootstrapPreviewResponse.ok === true;
    report.checks.push({
      name: "first-run create bootstraps Mindraw app when createBlankPackage capability file is unavailable",
      ok: process.platform === "darwin" ? expectedCreateBootstrap : createBootstrapState.blockers?.some((item) => item.code === "MINDRAW_CANVAS_CREATE_API_REQUIRED"),
      initialState: createBootstrapInitialState,
      state: createBootstrapState,
      previewHttpStatus: createBootstrapPreviewResponse.status,
    });
    const serialized = stableJson(report);
    report.redaction = {
      tokenIncluded: serialized.includes("m4c-mcpe-02-mock-token"),
      endpointIncluded: /127\.0\.0\.1:\d+/u.test(serialized),
      runtimePathIncluded: serialized.includes("write-api.json") || serialized.includes("mock-write-api.json"),
      rawPreviewBytesIncluded: serialized.includes("<svg"),
      rawDataUrlIncluded: serialized.includes("data:image") || serialized.includes("base64,")
    };
    report.checks.push({
      name: "HTTP smoke report omits token, endpoint, runtime path, raw preview bytes, and dataURL",
      ok: Object.values(report.redaction).every((value) => value === false),
      redaction: report.redaction
    });
    report.ok = report.checks.every((check) => check.ok === true);
    if (args.report) {
      await mkdir(dirname(args.report), { recursive: true });
      await writeFile(args.report, stableJson(report), "utf8");
    }
    console.log(stableJson(report));
  } finally {
    await new Promise((resolve) => server.close(resolve));
	    if (blockedServer) await new Promise((resolve) => blockedServer.close(resolve));
	    if (fallbackServer) await new Promise((resolve) => fallbackServer.close(resolve));
	    if (createBootstrapServer) await new Promise((resolve) => createBootstrapServer.close(resolve));
    await new Promise((resolve) => mockRuntime.server.close(resolve));
    await new Promise((resolve) => blockedRuntime.server.close(resolve));
    if (!args.keep) {
      await rm(root, { recursive: true, force: true });
    }
  }
}

async function smoke(args) {
  const root = await mkdtemp(join(tmpdir(), "mindraw-plugin-smoke-"));
  const canvasDir = join(root, "MindrawCanvas");
  const mockRuntime = await startMockMindrawRuntime(root);
  const previousCapabilityPath = process.env.MINDRAW_RUNTIME_CAPABILITY_PATH;
  process.env.MINDRAW_RUNTIME_CAPABILITY_PATH = mockRuntime.capabilityPath;
  const report = {
    ok: false,
    projectRoot: root,
    checks: [],
    redaction: {
      tokenIncluded: false,
      endpointIncluded: false,
      runtimePathIncluded: false,
      rawPreviewBytesIncluded: false,
      rawDataUrlIncluded: false
    }
  };
  try {
    const initial = publicState(await inspectProjectCanvas({ projectRoot: root, createNew: false }));
    report.checks.push({
      name: "empty project creates first canvas through Mindraw create API",
      ok: initial.status === "READY" && initial.latestCanvas?.name.endsWith("-01.mindraw") && initial.createResult?.created === true,
      state: initial
    });

    const one = publicState(await inspectProjectCanvas({ projectRoot: root, createNew: false }));
    report.checks.push({
      name: "repeat open does not create a new canvas",
      ok: one.status === "READY" && one.canvasCount === 1 && one.latestCanvas?.path === initial.latestCanvas?.path,
      latestCanvas: one.latestCanvas,
      createResult: one.createResult
    });

    const createNew = publicState(await inspectProjectCanvas({ projectRoot: root, createNew: true }));
    report.checks.push({
      name: "explicit new canvas increments same-day sequence",
      ok: createNew.status === "READY" && createNew.canvasCount === 2 && createNew.latestCanvas?.name.endsWith("-02.mindraw") && createNew.createResult?.created === true,
      latestCanvas: createNew.latestCanvas,
      createResult: createNew.createResult
    });

    const now = new Date();
    await utimes(initial.latestCanvas.path, now, new Date(now.getTime() + 60000));
    const two = publicState(await inspectProjectCanvas({ projectRoot: root, createNew: false }));
    report.checks.push({
      name: "latest-created registry ignores mtime and selects highest sequence",
      ok: two.status === "READY" && two.latestCanvas?.name === createNew.latestCanvas?.name && two.preview?.available === true,
      latestCanvas: two.latestCanvas,
      preview: two.preview
    });

    await rm(join(canvasDir, ".mindraw-canvas-registry.json"), { force: true });
    const recovered = publicState(await inspectProjectCanvas({ projectRoot: root, createNew: false }));
    report.checks.push({
      name: "missing registry recovers latest-created from canonical names",
      ok: recovered.status === "READY" && recovered.latestCanvas?.name === createNew.latestCanvas?.name,
      latestCanvas: recovered.latestCanvas
    });

    await mkdir(join(canvasDir, "notes.mindraw"), { recursive: true });
    const withNonstandard = publicState(await inspectProjectCanvas({ projectRoot: root, createNew: false }));
    report.checks.push({
      name: "nonstandard mindraw package is warned but not selected over canonical latest",
      ok: withNonstandard.status === "READY" && withNonstandard.latestCanvas?.name === createNew.latestCanvas?.name && withNonstandard.warnings?.some((item) => item.code === "CANVAS_NAME_NONSTANDARD"),
      latestCanvas: withNonstandard.latestCanvas,
      warnings: withNonstandard.warnings
    });

    const openDryRun = await openCanvasInMindraw({ canvasPath: withNonstandard.latestCanvas.path, dryRun: true });
    const openLive = await openCanvasInMindraw({ canvasPath: withNonstandard.latestCanvas.path, dryRun: false });
    report.checks.push({
      name: "desktop handoff uses Mindraw open package API",
      ok: openDryRun.method === "mindraw.app.open_package" && openLive.opened === true && openLive.fallbackUsed === false,
      openDryRun,
      openLive
    });

    const previewApiState = publicState(await inspectProjectCanvas({ projectRoot: root, createNew: false }));
    report.checks.push({
      name: "preview uses Mindraw preview snapshot API artifact",
      ok:
        previewApiState.preview?.available === true &&
        previewApiState.preview?.mimeType === "image/svg+xml" &&
        previewApiState.preview?.source === "mindraw-full-canvas-svg-preview-v1",
      preview: previewApiState.preview
    });

    const serialized = stableJson({ report, calls: mockRuntime.calls });
    report.redaction = {
      tokenIncluded: serialized.includes("m4c-mcpe-02-mock-token"),
      endpointIncluded: /127\.0\.0\.1:\d+/u.test(serialized),
      runtimePathIncluded: serialized.includes("write-api.json") || serialized.includes("mock-write-api.json"),
      rawPreviewBytesIncluded: serialized.includes("<svg"),
      rawDataUrlIncluded: serialized.includes("data:image") || serialized.includes("base64,")
    };
    report.checks.push({
      name: "sanitized report omits token, endpoint, runtime path, raw preview bytes, and dataURL",
      ok: Object.values(report.redaction).every((value) => value === false),
      redaction: report.redaction
    });

    report.rpcMethods = [...new Set(mockRuntime.calls.map((call) => call.method))];
    report.dtoSummary = {
      create: ["packagePath", "documentId", "created", "overwritten", "previewSnapshot metadata"],
      preview: ["artifactPath redacted in public state", "mimeType", "width", "height", "byteLength", "sha256", "source", "bytesIncluded=false"],
      open: ["packagePath", "opened", "documentId"]
    };
    report.ok = report.checks.every((check) => check.ok === true);
    if (args.report) {
      await mkdir(dirname(args.report), { recursive: true });
      await writeFile(args.report, stableJson(report), "utf8");
    }
    console.log(stableJson(report));
  } finally {
    if (previousCapabilityPath === undefined) {
      delete process.env.MINDRAW_RUNTIME_CAPABILITY_PATH;
    } else {
      process.env.MINDRAW_RUNTIME_CAPABILITY_PATH = previousCapabilityPath;
    }
    await new Promise((resolve) => mockRuntime.server.close(resolve));
    if (!args.keep) {
      await rm(root, { recursive: true, force: true });
    }
  }
}

async function smokeLifecycle(args) {
  const root = await mkdtemp(join(tmpdir(), "mindraw-plugin-lifecycle-smoke-"));
  const mockRuntime = await startMockMindrawRuntime(root);
  const previousCapabilityPath = process.env.MINDRAW_RUNTIME_CAPABILITY_PATH;
  process.env.MINDRAW_RUNTIME_CAPABILITY_PATH = mockRuntime.capabilityPath;
  const report = {
    ok: false,
    checks: [],
    matrix: [],
    redaction: {
      tokenIncluded: false,
      endpointIncluded: false,
      runtimePathIncluded: false,
      rawPreviewBytesIncluded: false,
      rawDataUrlIncluded: false
    }
  };
  const addCheck = (id, name, ok, evidence = {}) => {
    const check = { id, name, ok, evidence };
    report.checks.push(check);
    report.matrix.push({ id, status: ok ? "PASS" : "FAIL", name });
  };
  let scopedServiceA = null;
  let scopedServiceB = null;
  try {
    const projectA = join(root, "project-a");
    const projectB = join(root, "project-b");
    const projectDirConflict = join(root, "project-dir-conflict");
    const projectSequence = join(root, "project-sequence");
    const projectGitIgnored = join(root, "project-git-ignored");
    const projectGitSuggested = join(root, "project-git-suggested");
    await mkdir(projectA, { recursive: true });
    await mkdir(projectB, { recursive: true });
    await mkdir(projectDirConflict, { recursive: true });
    await mkdir(projectSequence, { recursive: true });
    await mkdir(projectGitIgnored, { recursive: true });
    await mkdir(projectGitSuggested, { recursive: true });

    const first = publicState(await inspectProjectCanvas({ projectRoot: projectA, createNew: false }));
    addCheck("L1", "first open creates today's first canvas through Mindraw create API", first.status === "READY" && first.latestCanvas?.name?.endsWith("-01.mindraw"), {
      status: first.status,
      latestCanvas: first.latestCanvas,
      createResult: first.createResult
    });

    const repeat = publicState(await inspectProjectCanvas({ projectRoot: projectA, createNew: false }));
    addCheck("L2", "repeat open does not create a second canvas", repeat.status === "READY" && repeat.canvasCount === 1 && repeat.latestCanvas?.path === first.latestCanvas?.path, {
      canvasCount: repeat.canvasCount,
      latestCanvas: repeat.latestCanvas
    });

    const explicitNew = publicState(await inspectProjectCanvas({ projectRoot: projectA, createNew: true }));
    addCheck("L3", "explicit new increments same-day sequence", explicitNew.status === "READY" && explicitNew.latestCanvas?.name?.endsWith("-02.mindraw"), {
      latestCanvas: explicitNew.latestCanvas,
      nextCanvasName: explicitNew.nextCanvasName
    });

    const now = new Date();
    await utimes(first.latestCanvas.path, now, new Date(now.getTime() + 120000));
    const afterMtime = publicState(await inspectProjectCanvas({ projectRoot: projectA, createNew: false }));
    addCheck("L4", "mtime changes do not override latest-created registry selection", afterMtime.status === "READY" && afterMtime.latestCanvas?.name === explicitNew.latestCanvas?.name, {
      latestCanvas: afterMtime.latestCanvas
    });

    const registryPathA = join(projectA, "MindrawCanvas", ".mindraw-canvas-registry.json");
    await rm(registryPathA, { force: true });
    const missingRegistry = publicState(await inspectProjectCanvas({ projectRoot: projectA, createNew: false }));
    addCheck("L5", "missing registry recovers from canonical canvas package names", missingRegistry.status === "READY" && missingRegistry.latestCanvas?.name === explicitNew.latestCanvas?.name, {
      latestCanvas: missingRegistry.latestCanvas,
      warnings: missingRegistry.warnings
    });

    await writeFile(registryPathA, "{ damaged json", "utf8");
    const damagedRegistry = publicState(await inspectProjectCanvas({ projectRoot: projectA, createNew: false }));
    addCheck("L6", "damaged registry is ignored with stable warning", damagedRegistry.status === "READY" && damagedRegistry.warnings?.some((item) => item.code === "REGISTRY_JSON_INVALID"), {
      warnings: damagedRegistry.warnings
    });

    await writeFile(registryPathA, stableJson({
      version: 1,
      projectRoot: first.projectRoot,
      canvases: [
        {
          name: "99.0101-01.mindraw",
          path: join(first.projectRoot, "MindrawCanvas", "missing.mindraw"),
          createdAt: "2099-01-01T00:00:01.000Z"
        }
      ],
      latestCreatedCanvasPath: join(first.projectRoot, "MindrawCanvas", "missing.mindraw")
    }), "utf8");
    const staleRegistry = publicState(await inspectProjectCanvas({ projectRoot: projectA, createNew: false }));
    addCheck("L7", "stale registry entry is ignored without selecting a missing canvas", staleRegistry.status === "READY" && staleRegistry.warnings?.some((item) => item.code === "REGISTRY_ENTRY_STALE") && staleRegistry.latestCanvas?.path !== join(projectA, "MindrawCanvas", "missing.mindraw"), {
      latestCanvas: staleRegistry.latestCanvas,
      warnings: staleRegistry.warnings
    });

    const projectBState = publicState(await inspectProjectCanvas({ projectRoot: projectB, createNew: false }));
    await writeFile(registryPathA, stableJson({
      version: 1,
      projectRoot: first.projectRoot,
      canvases: [
        {
          name: projectBState.latestCanvas.name,
          path: projectBState.latestCanvas.path,
          createdAt: "2099-01-01T00:00:02.000Z"
        }
      ],
      latestCreatedCanvasPath: projectBState.latestCanvas.path
    }), "utf8");
    const crossProject = publicState(await inspectProjectCanvas({ projectRoot: projectA, createNew: false }));
    addCheck("L8", "cross-project registry paths are not trusted", crossProject.status === "READY" && crossProject.warnings?.some((item) => item.code === "REGISTRY_ENTRY_OUTSIDE_CANVAS_DIR") && crossProject.latestCanvas?.path !== projectBState.latestCanvas.path, {
      latestCanvas: crossProject.latestCanvas,
      warnings: crossProject.warnings
    });

    await writeFile(join(projectDirConflict, "MindrawCanvas"), "not a directory", "utf8");
    const dirConflict = publicState(await inspectProjectCanvas({ projectRoot: projectDirConflict, createNew: false }));
    addCheck("L9", "MindrawCanvas file conflict returns stable blocker", dirConflict.status === "BLOCKED_CANVAS_DIR_NOT_DIRECTORY" && dirConflict.blockers?.[0]?.code === "CANVAS_DIR_NOT_DIRECTORY", {
      status: dirConflict.status,
      blockers: dirConflict.blockers
    });

    const sequenceCanvasDir = join(projectSequence, "MindrawCanvas");
    await mkdir(sequenceCanvasDir, { recursive: true });
    for (let sequence = 1; sequence <= 99; sequence += 1) {
      await mkdir(join(sequenceCanvasDir, `${currentSmokeDatePrefix()}${String(sequence).padStart(2, "0")}.mindraw`), { recursive: true });
    }
    const exhausted = publicState(await inspectProjectCanvas({ projectRoot: projectSequence, createNew: true }));
    addCheck("L10", "same-day sequence exhaustion fails closed without wraparound", exhausted.blockers?.some((item) => item.code === "CANVAS_SEQUENCE_EXHAUSTED"), {
      status: exhausted.status,
      blockers: exhausted.blockers,
      nextCanvasName: exhausted.nextCanvasName
    });

    const projectConflict = join(root, "project-sequence-conflict");
    await mkdir(join(projectConflict, "MindrawCanvas", `${currentSmokeDatePrefix()}01.mindraw`), { recursive: true });
    const sequenceConflict = publicState(await inspectProjectCanvas({ projectRoot: projectConflict, createNew: true }));
    addCheck("L11", "explicit new skips existing sequence and never overwrites", sequenceConflict.status === "READY" && sequenceConflict.latestCanvas?.name?.endsWith("-02.mindraw"), {
      latestCanvas: sequenceConflict.latestCanvas,
      createResult: sequenceConflict.createResult
    });

    await mkdir(join(projectA, "MindrawCanvas", "notes.mindraw"), { recursive: true });
    const nonstandard = publicState(await inspectProjectCanvas({ projectRoot: projectA, createNew: false }));
    addCheck("L12", "nonstandard package is warned but not promoted over canonical latest", nonstandard.status === "READY" && nonstandard.warnings?.some((item) => item.code === "CANVAS_NAME_NONSTANDARD"), {
      latestCanvas: nonstandard.latestCanvas,
      warnings: nonstandard.warnings
    });

    const isolatedA = publicState(await inspectProjectCanvas({ projectRoot: projectA, createNew: false }));
    const isolatedB = publicState(await inspectProjectCanvas({ projectRoot: projectB, createNew: false }));
	    addCheck("L13", "multi-project isolation keeps separate MindrawCanvas registries", isolatedA.latestCanvas?.path !== isolatedB.latestCanvas?.path && isolatedA.projectRoot !== isolatedB.projectRoot, {
	      projectACanvas: isolatedA.latestCanvas,
	      projectBCanvas: isolatedB.latestCanvas
	    });

	    const openCallCountBeforeScopedService = mockRuntime.calls.filter((call) => call.method === "mindraw.app.open_package").length;
	    scopedServiceA = await startProjectScopedPreviewService({ projectRoot: projectA, capabilityPath: mockRuntime.capabilityPath, preferredPort: 0 });
	    scopedServiceB = await startProjectScopedPreviewService({ projectRoot: projectB, capabilityPath: mockRuntime.capabilityPath, preferredPort: scopedServiceA.port });
	    const scopedProjectBRoot = scopedServiceB.service?.projectRoot || projectB;
	    const mismatchResponse = await fetch(withProjectContext(new URL("/api/open-edit", scopedServiceA.url).toString(), scopedProjectBRoot), {
	      method: "POST",
	      headers: { "content-type": "application/json" },
	      body: JSON.stringify({ projectRootHash: projectRootHash(scopedProjectBRoot), source: "lifecycle-port-mismatch" }),
	    });
	    const mismatchPayload = await mismatchResponse.json();
	    const scopedBOpen = await fetch(withProjectContext(new URL("/api/open-edit", scopedServiceB.url).toString(), scopedProjectBRoot), {
	      method: "POST",
	      headers: { "content-type": "application/json" },
	      body: JSON.stringify({ projectRootHash: projectRootHash(scopedProjectBRoot), source: "lifecycle-port-scoped" }),
	    }).then((response) => response.json());
	    const scopedOpenCalls = mockRuntime.calls.filter((call) => call.method === "mindraw.app.open_package").slice(openCallCountBeforeScopedService);
	    const scopedOpenedPaths = scopedOpenCalls.map((call) => call.params?.packagePath).filter(Boolean);
	    addCheck(
	      "L13b",
	      "project-scoped service avoids stale fixed-port project and rejects mismatched sidebar context",
	      scopedServiceA.port !== scopedServiceB.port &&
	        scopedServiceB.portSelection?.skippedPorts?.some((item) => item.reason === "PROJECT_CONTEXT_MISMATCH") &&
	        mismatchResponse.status === 409 &&
	        mismatchPayload.error === "MINDRAW_PROJECT_CONTEXT_MISMATCH" &&
	        scopedBOpen.ok === true &&
	        scopedBOpen.opened?.canvasPath === isolatedB.latestCanvas?.path &&
	        scopedOpenedPaths.every((item) => isPathInsideDir(resolveCanvasDir(scopedProjectBRoot), item)),
	      {
	        serviceAPort: scopedServiceA.port,
	        serviceBPort: scopedServiceB.port,
	        skippedPorts: scopedServiceB.portSelection?.skippedPorts,
	        mismatch: {
	          httpStatus: mismatchResponse.status,
	          error: mismatchPayload.error,
	          expectedProjectRootHash: mismatchPayload.expectedProjectRootHash,
	          receivedProjectRootHash: mismatchPayload.receivedProjectRootHash,
	        },
	        openedPathCount: scopedOpenedPaths.length,
	      },
	    );

	    await mkdir(join(projectGitIgnored, ".git"), { recursive: true });
    await writeFile(join(projectGitIgnored, ".gitignore"), "MindrawCanvas/\n", "utf8");
    const gitIgnored = publicState(await inspectProjectCanvas({ projectRoot: projectGitIgnored, createNew: false }));
    addCheck("L14", "git ignore already-present state is detected without modifying .gitignore", gitIgnored.gitIgnoreStatus?.status === "alreadyIgnored" && gitIgnored.gitIgnoreModified === false, {
      gitIgnoreStatus: gitIgnored.gitIgnoreStatus
    });

    await mkdir(join(projectGitSuggested, ".git"), { recursive: true });
    const gitSuggested = publicState(await inspectProjectCanvas({ projectRoot: projectGitSuggested, createNew: false }));
    addCheck("L15", "git ignore suggestion is reported without auto-writing .gitignore", gitSuggested.gitIgnoreStatus?.status === "suggested" && gitSuggested.gitIgnoreModified === false && !existsSync(join(projectGitSuggested, ".gitignore")), {
      gitIgnoreStatus: gitSuggested.gitIgnoreStatus,
      gitIgnoreExists: existsSync(join(projectGitSuggested, ".gitignore"))
    });

    const previewState = publicState(await inspectProjectCanvas({ projectRoot: projectA, createNew: false }));
    const openDryRun = await openCanvasInMindraw({ canvasPath: previewState.latestCanvas.path, dryRun: true });
    addCheck("L16", "preview and open API remain routed through Mindraw capabilities", previewState.preview?.available === true && openDryRun.method === "mindraw.app.open_package" && openDryRun.fallbackUsed === false, {
      preview: previewState.preview,
      openDryRun
    });

    const serialized = stableJson(report);
    report.redaction = {
      tokenIncluded: serialized.includes("m4c-mcpe-02-mock-token"),
      endpointIncluded: /127\.0\.0\.1:\d+/u.test(serialized),
      runtimePathIncluded: serialized.includes("write-api.json") || serialized.includes("mock-write-api.json"),
      rawPreviewBytesIncluded: serialized.includes("<svg"),
      rawDataUrlIncluded: serialized.includes("data:image") || serialized.includes("base64,")
    };
    addCheck("L17", "lifecycle smoke report omits token, endpoint, runtime path, raw preview bytes, and dataURL", Object.values(report.redaction).every((value) => value === false), {
      redaction: report.redaction
    });

    report.ok = report.checks.every((check) => check.ok === true);
    if (args.report) {
      await mkdir(dirname(args.report), { recursive: true });
      await writeFile(args.report, stableJson(report), "utf8");
    }
    console.log(stableJson(report));
	  } finally {
    if (previousCapabilityPath === undefined) {
      delete process.env.MINDRAW_RUNTIME_CAPABILITY_PATH;
	    } else {
	      process.env.MINDRAW_RUNTIME_CAPABILITY_PATH = previousCapabilityPath;
	    }
	    if (scopedServiceA?.server) await new Promise((resolve) => scopedServiceA.server.close(resolve));
	    if (scopedServiceB?.server) await new Promise((resolve) => scopedServiceB.server.close(resolve));
	    await new Promise((resolve) => mockRuntime.server.close(resolve));
    if (!args.keep) {
      await rm(root, { recursive: true, force: true });
    }
  }
}

function currentSmokeDatePrefix() {
  const now = new Date();
  return `${String(now.getFullYear() % 100).padStart(2, "0")}.${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-`;
}

async function mutateLatestPreviewArtifact({ projectRoot, capabilityPath, label = "refresh" }) {
  const state = await inspectProjectCanvas({ projectRoot, createNew: false, capabilityPath });
  if (!state.preview?.artifactPath) {
    throw new Error("Preview artifact is unavailable for mutation smoke.");
  }
  const version = `${label}-${Date.now()}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"><rect width="960" height="540" fill="#ffffff"/><rect x="24" y="24" width="180" height="120" fill="#7c3aed"/><rect x="360" y="210" width="240" height="110" fill="#06b6d4"/><rect x="720" y="400" width="120" height="80" fill="#f97316"/><text x="48" y="96" font-size="32">Mindraw refreshed preview</text><text x="48" y="154" font-size="20">${escapeHtml(version)}</text></svg>\n`;
  await writeFile(state.preview.artifactPath, svg, "utf8");
  const now = new Date();
  await utimes(state.preview.artifactPath, now, new Date(now.getTime() + 1000));
  return {
    previousRevision: state.preview.revision ?? null,
    byteLength: Buffer.byteLength(svg),
  };
}

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    // Continue to the optional external node_modules path below.
  }
  const moduleDirs = [process.env.PLAYWRIGHT_NODE_MODULES].filter(Boolean);
  for (const moduleDir of moduleDirs) {
    try {
      const requireFromBundle = createRequire(join(moduleDir, "package.json"));
      return requireFromBundle("playwright");
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error("Playwright is required for smoke-sidebar. Set PLAYWRIGHT_NODE_MODULES to a node_modules directory containing playwright.");
}

function playwrightLaunchOptions() {
  const executablePath = process.env.MINDRAW_PLAYWRIGHT_EXECUTABLE_PATH || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  return executablePath ? { headless: true, executablePath } : { headless: true };
}

async function sidebarPlaywrightSmoke(args) {
  const root = await mkdtemp(join(tmpdir(), "mindraw-plugin-sidebar-smoke-"));
  const mockRuntime = await startMockMindrawRuntime(root);
  const outDir = args.out || (args.report ? join(dirname(args.report), "sidebar-playwright") : join(root, "sidebar-playwright"));
  await mkdir(outDir, { recursive: true });
  const report = {
    ok: false,
    checks: [],
    screenshots: {},
    redaction: {
      tokenIncluded: false,
      endpointIncluded: false,
      runtimePathIncluded: false,
      rawPreviewBytesIncluded: false,
      rawDataUrlIncluded: false,
    },
  };
  const addCheck = (name, ok, evidence = {}) => {
    report.checks.push({ name, ok, evidence });
  };
  let server = null;
  let blockedServer = null;
  let unavailableServer = null;
  let browser = null;
  try {
    const { chromium } = await loadPlaywright();
    const projectRoot = join(root, "project-ready");
    await mkdir(projectRoot, { recursive: true });
    ({ server } = await createPreviewServer({ projectRoot, capabilityPath: mockRuntime.capabilityPath }));
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch(playwrightLaunchOptions());

    const runViewport = async ({ width, height, label }) => {
      const page = await browser.newPage({ viewport: { width, height } });
      const openCallStart = mockRuntime.calls.filter((call) => call.method === "mindraw.app.open_package").length;
      try {
        await page.goto(baseUrl, { waitUntil: "networkidle" });
        await page.waitForSelector("#previewImage", { state: "visible" });
        await page.waitForFunction(() => window.__mindrawPreviewState?.previewAvailable === true && window.__mindrawPreviewState?.loading === false);
        const initial = await page.evaluate(() => {
          const viewport = document.getElementById("viewport").getBoundingClientRect();
          const image = document.getElementById("previewImage").getBoundingClientRect();
          const controls = ["zoomOut", "zoomIn", "zoomLabel", "reset", "edit", "openStatus"].every((id) => {
            const rect = document.getElementById(id).getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
          const refreshControl = document.getElementById("refresh").getBoundingClientRect();
          return {
            state: window.__mindrawPreviewState,
            viewport: { width: viewport.width, height: viewport.height },
            image: { width: image.width, height: image.height, left: image.left, top: image.top, right: image.right, bottom: image.bottom },
            controls: controls && refreshControl.width > 0 && refreshControl.height > 0,
            title: document.querySelector("h1")?.textContent,
            status: document.querySelector(".pill")?.textContent,
          };
        });
        const initialScreenshot = join(outDir, `sidebar-${label}-initial.png`);
        await page.screenshot({ path: initialScreenshot, fullPage: true });

        const pixelEvidence = await page.evaluate(async () => {
          const img = document.getElementById("previewImage");
          const canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0);
          const samples = [
            [24, 24],
            [Math.floor(canvas.width / 2), Math.floor(canvas.height / 2)],
            [48, 96],
            [Math.max(0, canvas.width - 24), Math.max(0, canvas.height - 24)],
          ].map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data));
          const unique = new Set(samples.map((item) => item.join(",")));
          return {
            naturalWidth: img.naturalWidth,
            naturalHeight: img.naturalHeight,
            sampledPixelCount: samples.length,
            uniqueColorCount: unique.size,
          };
        });

        await page.click("#zoomIn");
        await page.waitForTimeout(80);
        const afterZoomIn = await page.evaluate(() => window.__mindrawPreviewState);
        await page.click("#zoomOut");
        await page.waitForTimeout(80);
        const afterZoomOut = await page.evaluate(() => window.__mindrawPreviewState);
        await page.mouse.move(Math.floor(width / 2), Math.floor(height / 2));
        await page.mouse.down();
        await page.mouse.move(Math.floor(width / 2) - 46, Math.floor(height / 2) - 32, { steps: 4 });
        await page.mouse.up();
        await page.waitForTimeout(80);
        const afterPan = await page.evaluate(() => window.__mindrawPreviewState);
        await page.click("#reset");
        await page.waitForTimeout(80);
        const afterReset = await page.evaluate(() => window.__mindrawPreviewState);
        await mutateLatestPreviewArtifact({ projectRoot, capabilityPath: mockRuntime.capabilityPath, label: `sidebar-${label}` });
        await page.click("#refresh");
        await page.waitForFunction(
          (previousRevision) => window.__mindrawPreviewState?.revision && window.__mindrawPreviewState.revision !== previousRevision && window.__mindrawPreviewState.loading === false,
          afterReset.revision,
          { timeout: 4000 }
        );
        const afterRefresh = await page.evaluate(() => window.__mindrawPreviewState);
        const interactionScreenshot = join(outDir, `sidebar-${label}-interaction.png`);
        await page.screenshot({ path: interactionScreenshot, fullPage: true });

        await page.click("#edit");
        await page.waitForFunction(() => window.__mindrawOpenEditState?.status !== "opening", null, { timeout: 3000 }).catch(() => {});
        const afterClickOpenState = await page.evaluate(() => ({
          statusText: document.getElementById("openStatus")?.textContent,
          openState: window.__mindrawOpenEditState,
        }));
        await page.dblclick("#previewImage");
        await page.waitForFunction(() => window.__mindrawOpenEditState?.status !== "opening", null, { timeout: 3000 }).catch(() => {});
        const afterDoubleClickOpenState = await page.evaluate(() => ({
          statusText: document.getElementById("openStatus")?.textContent,
          openState: window.__mindrawOpenEditState,
        }));
        const openCalls = mockRuntime.calls.filter((call) => call.method === "mindraw.app.open_package").slice(openCallStart);
        const openedPaths = [...new Set(openCalls.map((call) => call.params?.packagePath).filter(Boolean))];

        const viewportOk =
          initial.state.previewAvailable === true &&
          initial.state.loading === false &&
          initial.image.width > 80 &&
          initial.image.height > 45 &&
          initial.image.left >= -1 &&
          initial.image.right <= width + 1 &&
          initial.controls === true;
        const zoomOk = afterZoomIn.scale > initial.state.scale && afterZoomOut.scale <= afterZoomIn.scale;
        const panOk = Math.abs(afterPan.x - afterZoomOut.x) > 8 || Math.abs(afterPan.y - afterZoomOut.y) > 8;
        const resetOk = Math.abs(afterReset.scale - afterReset.fitScale) < 0.001;
        const openOk =
          openCalls.length >= 2 &&
          openedPaths.length === 1 &&
          afterClickOpenState.openState?.ok === true &&
          afterClickOpenState.statusText?.includes("Mindraw opened") &&
          afterClickOpenState.openState?.userActionRequired === true &&
          afterDoubleClickOpenState.openState?.ok === true &&
          afterDoubleClickOpenState.statusText?.includes("Mindraw opened") &&
          afterDoubleClickOpenState.openState?.userActionRequired === true;
	        const refreshOk =
	          afterReset.revision &&
	          afterRefresh.revision &&
	          afterRefresh.revision !== afterReset.revision &&
	          afterRefresh.previewSrc?.includes("/api/preview?project=") &&
	          afterRefresh.loading === false;
        const pixelOk = pixelEvidence.naturalWidth > 0 && pixelEvidence.naturalHeight > 0 && pixelEvidence.uniqueColorCount >= 2;
        report.screenshots[`initial_${label}`] = initialScreenshot;
        report.screenshots[`interaction_${label}`] = interactionScreenshot;
        return {
          label,
          ok: viewportOk && zoomOk && panOk && resetOk && refreshOk && openOk && pixelOk,
          viewportOk,
          zoomOk,
          panOk,
          resetOk,
          refreshOk,
          openOk,
          pixelOk,
          initial,
          afterZoomIn,
          afterZoomOut,
          afterPan,
          afterReset,
          afterRefresh,
          pixelEvidence,
          openedPathCount: openedPaths.length,
          openCallCount: openCalls.length,
          afterClickOpenState,
          afterDoubleClickOpenState,
        };
      } finally {
        await page.close();
      }
    };

    const viewport360 = await runViewport({ width: 360, height: 720, label: "360x720" });
    const viewport480 = await runViewport({ width: 480, height: 800, label: "480x800" });
    addCheck("360x720 sidebar fit / pan / zoom / reset / edit / double-click", viewport360.ok, viewport360);
    addCheck("480x800 sidebar fit / pan / zoom / reset / edit / double-click", viewport480.ok, viewport480);

    const blockedRoot = join(root, "project-blocked");
    await mkdir(blockedRoot, { recursive: true });
    await writeFile(join(blockedRoot, "MindrawCanvas"), "not a directory", "utf8");
    ({ server: blockedServer } = await createPreviewServer({ projectRoot: blockedRoot, capabilityPath: mockRuntime.capabilityPath }));
    await new Promise((resolve, reject) => {
      blockedServer.once("error", reject);
      blockedServer.listen(0, "127.0.0.1", resolve);
    });
    const blockedPage = await browser.newPage({ viewport: { width: 360, height: 720 } });
    await blockedPage.goto(`http://127.0.0.1:${blockedServer.address().port}`, { waitUntil: "networkidle" });
    await blockedPage.waitForSelector("#emptyState");
    const blockedText = await blockedPage.locator("#emptyState").innerText();
    const blockedScreenshot = join(outDir, "sidebar-blocked-360x720.png");
    await blockedPage.screenshot({ path: blockedScreenshot, fullPage: true });
    await blockedPage.close();
    report.screenshots.blocked_360x720 = blockedScreenshot;
    addCheck("blocked state is visible and diagnostic", blockedText.includes("CANVAS_DIR_NOT_DIRECTORY"), { blockedText });

    const unavailableRoot = join(root, "project-unavailable");
    await mkdir(unavailableRoot, { recursive: true });
    ({ server: unavailableServer } = await createPreviewServer({ projectRoot: unavailableRoot, capabilityPath: join(root, "missing-write-api.json") }));
    await new Promise((resolve, reject) => {
      unavailableServer.once("error", reject);
      unavailableServer.listen(0, "127.0.0.1", resolve);
    });
    const unavailablePage = await browser.newPage({ viewport: { width: 360, height: 720 } });
    await unavailablePage.goto(`http://127.0.0.1:${unavailableServer.address().port}`, { waitUntil: "networkidle" });
    await unavailablePage.waitForSelector("#emptyState");
    const unavailableText = await unavailablePage.locator("#emptyState").innerText();
    const unavailableScreenshot = join(outDir, "sidebar-unavailable-360x720.png");
    await unavailablePage.screenshot({ path: unavailableScreenshot, fullPage: true });
    await unavailablePage.close();
    report.screenshots.unavailable_360x720 = unavailableScreenshot;
    addCheck("runtime unavailable state is visible and redacted", unavailableText.includes("MINDRAW_CANVAS_CREATE_API_REQUIRED"), { unavailableText });

    const serialized = stableJson(report);
    report.redaction = {
      tokenIncluded: serialized.includes("m4c-mcpe-02-mock-token"),
      endpointIncluded: /127\.0\.0\.1:\d+/u.test(serialized),
      runtimePathIncluded: serialized.includes("write-api.json") || serialized.includes("mock-write-api.json"),
      rawPreviewBytesIncluded: serialized.includes("<svg"),
      rawDataUrlIncluded: serialized.includes("data:image") || serialized.includes("base64,"),
    };
    addCheck("Playwright sidebar report omits token, endpoint, runtime path, raw preview bytes, and dataURL", Object.values(report.redaction).every((value) => value === false), {
      redaction: report.redaction,
    });

    report.ok = report.checks.every((check) => check.ok === true);
    if (args.report) {
      await mkdir(dirname(args.report), { recursive: true });
      await writeFile(args.report, stableJson(report), "utf8");
    }
    console.log(stableJson(report));
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    if (blockedServer) await new Promise((resolve) => blockedServer.close(resolve));
    if (unavailableServer) await new Promise((resolve) => unavailableServer.close(resolve));
    await new Promise((resolve) => mockRuntime.server.close(resolve));
    if (!args.keep) {
      await rm(root, { recursive: true, force: true });
    }
  }
}

async function main() {
  const [command = "help", ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (command === "serve") {
    await serve(args);
    return;
  }
  if (command === "smoke") {
    await smoke(args);
    return;
  }
  if (command === "smoke-mcp") {
    await mcpSmoke(args);
    return;
  }
  if (command === "smoke-http") {
    await httpSmoke(args);
    return;
  }
  if (command === "smoke-lifecycle") {
    await smokeLifecycle(args);
    return;
  }
  if (command === "smoke-sidebar") {
    await sidebarPlaywrightSmoke(args);
    return;
  }
  console.log(`Usage:
  mindraw-canvas-service.mjs serve --project-root <path> [--port 43227 preferred] [--capability <write-api.json>]
  mindraw-canvas-service.mjs smoke [--report <json>] [--keep]
  mindraw-canvas-service.mjs smoke-mcp [--report <json>] [--keep]
  mindraw-canvas-service.mjs smoke-http [--report <json>] [--keep]
  mindraw-canvas-service.mjs smoke-lifecycle [--report <json>] [--keep]
  mindraw-canvas-service.mjs smoke-sidebar [--report <json>] [--out <dir>] [--keep]`);
}

main().catch((error) => {
  console.error(stableJson({ ok: false, error: error.code || "INTERNAL_ERROR", message: error.message }));
  process.exit(1);
});
