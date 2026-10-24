#!/usr/bin/env node
import { inspectProjectCanvas, openCanvasInMindraw, performProjectCanvasRecovery, publicState, stableJson } from "../lib/project-canvas.mjs";

import { readFrameLink } from '../lib/frame-read.mjs';

let nextId = 1;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function toolDefinitions() {
  return [
    {
      name: "read_mindraw_frame",
      description: "Read a complete mindraw://localhost Frame link from an already open Mindraw document. Returns target-only text, annotation elements, revisions and a PNG image. Read-only: never opens, edits or scans packages. Prefer this tool for pasted Mindraw Frame links.",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      inputSchema: { type: "object", properties: { link: { type: "string", description: "Complete Mindraw Frame URL including documentId, elementId and optional packageFormat." } }, required: ["link"], additionalProperties: false }
    },
    {
      name: "inspect_mindraw_project_canvas",
      description: "Inspect the current project's MindrawCanvas directory and return a sanitized project canvas state.",
      inputSchema: {
        type: "object",
        properties: {
          projectRoot: { type: "string", description: "Project root. Defaults to the caller working directory." },
          createNew: { type: "boolean", description: "Request a new canvas through Mindraw createBlankPackage. Never handwrites .mindraw internals." }
        },
        additionalProperties: false
      }
    },
    {
      name: "open_mindraw_project_canvas",
      description: "Inspect and optionally hand off the App-confirmed healthy project canvas to the Mindraw desktop app.",
      inputSchema: {
        type: "object",
        properties: {
          projectRoot: { type: "string", description: "Project root. Defaults to the caller working directory." },
          createNew: { type: "boolean", description: "Request a new canvas through Mindraw createBlankPackage. Does not handwrite .mindraw packages." },
          dryRunOpen: { type: "boolean", description: "Return the open command without launching Mindraw." }
        },
        additionalProperties: false
      }
    },
    {
      name: "recover_mindraw_project_canvas",
      description: "Perform an explicit project canvas recovery choice through Mindraw App APIs. It never writes .mindraw internals directly.",
      inputSchema: {
        type: "object",
        properties: {
          projectRoot: { type: "string", description: "Project root. Defaults to the caller working directory." },
          action: { type: "string", enum: ["repair_current", "open_other_healthy", "create_new"], description: "The explicit recovery action chosen by the user." },
          canvasName: { type: "string", description: "Required only for open_other_healthy; choose a name returned in recovery.otherHealthyCanvases." },
          dryRunOpen: { type: "boolean", description: "For open_other_healthy, return the App handoff without launching Mindraw." }
        },
        required: ["action"],
        additionalProperties: false
      }
    }
  ];
}

async function handleToolCall(name, args = {}) {
  if (name === "inspect_mindraw_project_canvas") {
    const state = await inspectProjectCanvas({
      projectRoot: args.projectRoot || process.cwd(),
      createNew: args.createNew === true
    });
    return {
      ok: state.ok === true,
      error: state.ok === true ? undefined : state.blockers?.[0]?.code || state.status,
      state: publicState(state)
    };
  }
  if (name === "open_mindraw_project_canvas") {
    const state = await inspectProjectCanvas({
      projectRoot: args.projectRoot || process.cwd(),
      createNew: args.createNew === true
    });
    const publicCanvasState = publicState(state);
    if (!state.latestCanvas?.path) {
      return {
        ok: false,
        error: state.recovery ? "ACTION_REQUIRED_CANVAS_RECOVERY" : state.blockers?.[0]?.code || "MINDRAW_CANVAS_CREATE_API_REQUIRED",
        state: publicCanvasState
      };
    }
    const opened = await openCanvasInMindraw({
      canvasPath: state.latestCanvas.path,
      healthConfirmed: true,
      dryRun: args.dryRunOpen === true
    });
    return { ok: true, opened, state: publicCanvasState };
  }
  if (name === "recover_mindraw_project_canvas") {
    const result = await performProjectCanvasRecovery({
      projectRoot: args.projectRoot || process.cwd(),
      action: args.action,
      canvasName: args.canvasName || null,
      dryRunOpen: args.dryRunOpen === true,
    });
    return {
      ok: result.state?.ok === true || result.opened?.ok === true || result.repaired?.repaired === true,
      action: result.action,
      opened: result.opened,
      repaired: result.repaired,
      state: result.state ? publicState(result.state) : null,
    };
  }
  return { ok: false, error: "UNKNOWN_TOOL", message: `Unknown tool: ${name}` };
}

async function handle(message) {
  if (message.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "mindraw-project-canvas", version: "0.2.0" }
      }
    };
  }
  if (message.method === "tools/list") {
    return { jsonrpc: "2.0", id: message.id, result: { tools: toolDefinitions() } };
  }
  if (message.method === "tools/call") {
    if (message.params?.name === 'read_mindraw_frame') {
      try { return { jsonrpc: '2.0', id: message.id, result: await readFrameLink(message.params?.arguments?.link) }; }
      catch (error) { return { jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: error.code || 'FRAME_READ_FAILED', message: error.code ? error.message : 'Frame reading failed.' }) }], isError: true } }; }
    }
    let result;
    try {
      result = await handleToolCall(message.params?.name, message.params?.arguments || {});
    } catch (error) {
      result = {
        ok: false,
        error: error.code || "MINDRAW_PROJECT_CANVAS_TOOL_FAILED",
        message: error.message,
        details: error.details || {}
      };
    }
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        content: [{ type: "text", text: stableJson(result) }],
        isError: result.ok === false
      }
    };
  }
  if (message.id !== undefined) {
    return {
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32601, message: `Method not found: ${message.method}` }
    };
  }
  return null;
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", async (chunk) => {
  buffer += chunk;
  const lines = buffer.split(/\r?\n/);
  buffer = lines.pop() || "";
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const message = JSON.parse(line);
      const response = await handle(message);
      if (response) send(response);
    } catch (error) {
      send({
        jsonrpc: "2.0",
        id: nextId++,
        error: { code: -32000, message: error.message || "Internal error" }
      });
    }
  }
});
