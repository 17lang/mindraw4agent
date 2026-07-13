#!/usr/bin/env node
import { inspectProjectCanvas, openCanvasInMindraw, publicState, stableJson } from "../lib/project-canvas.mjs";

let nextId = 1;

function send(message) {
  process.stdout.write(`${stableJson(message)}\n`);
}

function toolDefinitions() {
  return [
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
      description: "Inspect and optionally hand off the latest project canvas to the Mindraw desktop app.",
      inputSchema: {
        type: "object",
        properties: {
          projectRoot: { type: "string", description: "Project root. Defaults to the caller working directory." },
          createNew: { type: "boolean", description: "Request a new canvas through Mindraw createBlankPackage. Does not handwrite .mindraw packages." },
          dryRunOpen: { type: "boolean", description: "Return the open command without launching Mindraw." }
        },
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
        error: state.blockers?.[0]?.code || "MINDRAW_CANVAS_CREATE_API_REQUIRED",
        state: publicCanvasState
      };
    }
    const opened = await openCanvasInMindraw({
      canvasPath: state.latestCanvas.path,
      dryRun: args.dryRunOpen === true
    });
    return { ok: true, opened, state: publicCanvasState };
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
        serverInfo: { name: "mindraw-project-canvas", version: "0.1.0" }
      }
    };
  }
  if (message.method === "tools/list") {
    return { jsonrpc: "2.0", id: message.id, result: { tools: toolDefinitions() } };
  }
  if (message.method === "tools/call") {
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
