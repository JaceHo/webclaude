// Strip Claude Code env vars BEFORE any imports that might spawn subprocesses.
// The SDK inherits process.env when spawning `claude` CLI — if CLAUDECODE=1
// is set (e.g. when server is started from within Claude Code), the subprocess
// refuses to start with "cannot be launched inside another Claude Code session".
delete process.env.CLAUDECODE;
delete process.env.CLAUDE_CODE_ENTRYPOINT;

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ServerWebSocket } from "bun";
import { SessionStore } from "./session-store.js";
import { ConnectionManager, type WSData } from "./connection-manager.js";
import { AgentRunner } from "./agent-runner.js";
import { MessageStore } from "./message-store.js";
import { WSHandler } from "./ws-handler.js";
import { createApiRoutes } from "./routes/api.js";

const sessionStore = new SessionStore();
const connectionManager = new ConnectionManager();
const agentRunner = new AgentRunner();
const messageStore = new MessageStore();
const wsHandler = new WSHandler(connectionManager, agentRunner, sessionStore, messageStore);

const app = new Hono();

// CORS for dev mode
app.use("/api/*", cors({ origin: "*" }));

// REST API
const apiRoutes = createApiRoutes(sessionStore, agentRunner, connectionManager, messageStore);
app.route("/api", apiRoutes);

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

const PORT = parseInt(process.env.PORT || "3001");

Bun.serve<WSData>({
  port: PORT,
  fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade
    if (url.pathname === "/ws") {
      const upgraded = server.upgrade(req, {
        data: { subscribedSessions: new Set<string>() },
      });
      if (upgraded) return undefined as unknown as Response;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // Hono handles everything else
    return app.fetch(req);
  },
  websocket: {
    open(ws: ServerWebSocket<WSData>) {
      wsHandler.onOpen(ws);
    },
    message(ws: ServerWebSocket<WSData>, message) {
      wsHandler.onMessage(ws, message);
    },
    close(ws: ServerWebSocket<WSData>) {
      wsHandler.onClose(ws);
    },
  },
});

console.log(`WebClaude server running on http://localhost:${PORT}`);

// Prevent server crash from unhandled errors in SDK subprocesses
process.on("uncaughtException", (err) => {
  console.error("[Server] Uncaught exception (server stays alive):", err.message);
});
process.on("unhandledRejection", (reason) => {
  console.error("[Server] Unhandled rejection (server stays alive):", reason);
});

// Graceful shutdown
process.on("SIGINT", async () => {
  await agentRunner.closeAll();
  process.exit(0);
});
