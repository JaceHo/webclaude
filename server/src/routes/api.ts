import { Hono } from "hono";
import type { SessionStore } from "../session-store.js";
import type { AgentRunner } from "../agent-runner.js";
import type { ConnectionManager } from "../connection-manager.js";
import type { MessageStore } from "../message-store.js";
import type { FeishuBridge } from "../feishu/feishu-bridge.js";
import type { CreateSessionRequest, UpdateSessionRequest, CreateCronRequest, UpdateCronRequest } from "@ctrlnect/shared";
import { AVAILABLE_MODELS } from "@ctrlnect/shared";
import type { CronStore } from "../cron-store.js";
import type { CronScheduler } from "../cron-scheduler.js";
import { readImportableEntries, syncCommandCrons } from "../crontab-service.js";
import type { ServiceStore } from "../service-store.js";
import { detectApiProvider, setPreferredProvider, type ApiProvider } from "../agent-runner.js";

export function createApiRoutes(
  sessionStore: SessionStore,
  agentRunner: AgentRunner,
  connectionManager: ConnectionManager,
  messageStore: MessageStore,
  feishuBridge: FeishuBridge | null = null,
  cronStore: CronStore | null = null,
  cronScheduler: CronScheduler | null = null,
  serviceStore: ServiceStore | null = null,
) {
  const api = new Hono();

  // List all sessions
  api.get("/sessions", (c) => {
    return c.json(sessionStore.getAll());
  });

  // Create a new session
  api.post("/sessions", async (c) => {
    const body = (await c.req.json()) as CreateSessionRequest;
    const session = sessionStore.create(body);
    connectionManager.broadcastAll({
      type: "session_update",
      session,
    });
    return c.json(session, 201);
  });

  // Get a single session
  api.get("/sessions/:id", (c) => {
    const session = sessionStore.get(c.req.param("id"));
    if (!session) return c.json({ error: "Not found" }, 404);
    return c.json(session);
  });

  // Update a session
  api.patch("/sessions/:id", async (c) => {
    const body = (await c.req.json()) as UpdateSessionRequest;
    const session = sessionStore.update(c.req.param("id"), body);
    if (!session) return c.json({ error: "Not found" }, 404);
    connectionManager.broadcastAll({
      type: "session_update",
      session,
    });
    return c.json(session);
  });

  // Get messages for a session
  api.get("/sessions/:id/messages", (c) => {
    const id = c.req.param("id");
    const session = sessionStore.get(id);
    if (!session) return c.json({ error: "Not found" }, 404);
    return c.json(messageStore.getAll(id));
  });

  // Delete a session
  api.delete("/sessions/:id", async (c) => {
    const id = c.req.param("id");
    // Kill running agent if any
    if (agentRunner.isRunning(id)) {
      await agentRunner.interrupt(id);
    }
    messageStore.delete(id);
    const deleted = sessionStore.delete(id);
    if (!deleted) return c.json({ error: "Not found" }, 404);
    return c.json({ ok: true });
  });

  // List available models
  api.get("/models", (c) => {
    return c.json(AVAILABLE_MODELS);
  });

  // ── Feishu integration routes ───────────────────────────────────────────────

  /** GET /api/feishu/session/:id/history – load older messages from Feishu. */
  api.get("/feishu/session/:id/history", async (c) => {
    if (!feishuBridge) return c.json({ error: "Feishu not enabled" }, 503);
    const sessionId = c.req.param("id");
    const beforeTime = parseInt(c.req.query("before_time") || String(Date.now()));
    try {
      await feishuBridge.loadHistoryBefore(sessionId, beforeTime);
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
    return c.json(messageStore.getAll(sessionId));
  });

  /** GET /api/feishu/status – returns bridge status or disabled notice. */
  api.get("/feishu/status", (c) => {
    if (!feishuBridge) {
      return c.json({
        enabled: false,
        message:
          'Feishu integration disabled. Set enabled=true in ~/.openclaw/config.json',
      });
    }
    return c.json(feishuBridge.getStatus());
  });

  /** POST /api/feishu/send – manually send a message to a Feishu DM session.
   *  Body: { sessionId: string, text: string }
   */
  api.post("/feishu/send", async (c) => {
    if (!feishuBridge) {
      return c.json({ error: "Feishu integration not enabled" }, 503);
    }
    const { sessionId, text } = (await c.req.json()) as {
      sessionId: string;
      text: string;
    };
    if (!sessionId || !text) {
      return c.json({ error: "sessionId and text are required" }, 400);
    }
    if (!feishuBridge.isFeishuSession(sessionId)) {
      return c.json({ error: "Not a Feishu session" }, 404);
    }
    await feishuBridge.forwardReplyToFeishu(sessionId, text);
    return c.json({ ok: true });
  });

  // ── Cron job routes ──────────────────────────────────────────────────────────

  api.get("/crons", (c) => {
    if (!cronStore) return c.json([]);
    return c.json(cronStore.getAll());
  });

  api.post("/crons", async (c) => {
    if (!cronStore || !cronScheduler) return c.json({ error: "Crons not available" }, 503);
    const body = (await c.req.json()) as CreateCronRequest;
    const isCommand = body.type === "command";
    if (!body.name || !body.schedule || !body.prompt) {
      return c.json({ error: "name, schedule, and prompt are required" }, 400);
    }
    if (!isCommand && !body.sessionId) {
      return c.json({ error: "sessionId is required for prompt-type crons" }, 400);
    }
    const cron = cronStore.create(body);
    cronScheduler.refreshNextRun(cron.id);
    connectionManager.broadcastAll({ type: "cron_update", cron: cronStore.get(cron.id)! });
    // Sync command crons to system crontab
    if (isCommand) {
      const commandCrons = cronStore.getAll().filter((c) => c.type === "command");
      await syncCommandCrons(commandCrons).catch((e) => console.warn("[crontab] sync failed:", e));
    }
    return c.json(cron, 201);
  });

  api.patch("/crons/:id", async (c) => {
    if (!cronStore || !cronScheduler) return c.json({ error: "Crons not available" }, 503);
    const body = (await c.req.json()) as UpdateCronRequest;
    const cron = cronStore.update(c.req.param("id"), body);
    if (!cron) return c.json({ error: "Not found" }, 404);
    if (body.schedule !== undefined || body.enabled !== undefined) {
      cronScheduler.refreshNextRun(cron.id);
    }
    connectionManager.broadcastAll({ type: "cron_update", cron: cronStore.get(cron.id)! });
    // Sync command crons after any update
    if (cron.type === "command" || body.type === "command") {
      const commandCrons = cronStore.getAll().filter((c) => c.type === "command");
      await syncCommandCrons(commandCrons).catch((e) => console.warn("[crontab] sync failed:", e));
    }
    return c.json(cronStore.get(cron.id));
  });

  api.delete("/crons/:id", async (c) => {
    if (!cronStore) return c.json({ error: "Crons not available" }, 503);
    const cron = cronStore.get(c.req.param("id"));
    const wasCommand = cron?.type === "command";
    const deleted = cronStore.delete(c.req.param("id"));
    if (!deleted) return c.json({ error: "Not found" }, 404);
    // Sync to remove entry from system crontab
    if (wasCommand) {
      const commandCrons = cronStore.getAll().filter((c) => c.type === "command");
      await syncCommandCrons(commandCrons).catch((e) => console.warn("[crontab] sync failed:", e));
    }
    // Broadcast updated list so all connected clients drop the deleted entry immediately
    connectionManager.broadcastAll({ type: "cron_list", crons: cronStore.getAll() });
    return c.json({ ok: true });
  });

  // Read importable (user-owned) system crontab entries
  api.get("/crons/system", async (c) => {
    const entries = await readImportableEntries().catch(() => []);
    return c.json(entries);
  });

  // Import all user-owned system crontab entries as command crons (idempotent)
  api.post("/crons/import-system", async (c) => {
    if (!cronStore || !cronScheduler) return c.json({ error: "Crons not available" }, 503);
    const entries = await readImportableEntries().catch(() => []);
    const existing = cronStore.getAll();
    const created = [];
    for (const entry of entries) {
      // Skip if a command cron with the same command already exists (idempotent)
      const duplicate = existing.find(
        (c) => c.type === "command" && c.prompt === entry.command,
      );
      if (duplicate) continue;
      const name = entry.command.split(" ").pop()?.split("/").pop() ?? entry.command.slice(0, 30);
      const cron = cronStore.create({
        type: "command",
        sessionId: "",
        name,
        schedule: entry.schedule,
        prompt: entry.command,
        enabled: true,
      });
      cronScheduler.refreshNextRun(cron.id);
      connectionManager.broadcastAll({ type: "cron_update", cron: cronStore.get(cron.id)! });
      created.push(cron);
    }
    // Re-sync after batch import (marks them all as managed)
    const commandCrons = cronStore.getAll().filter((c) => c.type === "command");
    await syncCommandCrons(commandCrons).catch((e) => console.warn("[crontab] sync failed:", e));
    return c.json({ imported: created.length, crons: created }, 201);
  });

  api.get("/crons/:id/logs", (c) => {
    if (!cronStore) return c.json([]);
    const cron = cronStore.get(c.req.param("id"));
    if (!cron) return c.json({ error: "Not found" }, 404);
    const logs = cronStore.getLogs(cron.id);
    // Return newest first
    return c.json(logs.reverse());
  });

  api.post("/crons/:id/trigger", async (c) => {
    if (!cronScheduler) return c.json({ error: "Crons not available" }, 503);
    const cron = cronStore?.get(c.req.param("id"));
    if (!cron) return c.json({ error: "Not found" }, 404);
    cronScheduler.trigger(cron.id);
    return c.json({ ok: true });
  });

  // ── Service management routes ─────────────────────────────────────────────────

  api.get("/services", (c) => {
    if (!serviceStore) return c.json([]);
    return c.json(serviceStore.getAll());
  });

  api.post("/services", async (c) => {
    if (!serviceStore) return c.json({ error: "Service store not available" }, 503);
    const body = (await c.req.json()) as {
      name: string;
      description?: string;
      command: string;
      cwd?: string;
      logPath?: string;
    };
    if (!body.name || !body.command) {
      return c.json({ error: "name and command are required" }, 400);
    }
    const service = serviceStore.create(body);
    return c.json(service, 201);
  });

  api.put("/services/:id", async (c) => {
    if (!serviceStore) return c.json({ error: "Service store not available" }, 503);
    const id = c.req.param("id");
    const body = (await c.req.json()) as {
      name?: string;
      description?: string;
      command?: string;
      cwd?: string;
      logPath?: string;
    };
    const service = serviceStore.get(id);
    if (!service) {
      return c.json({ error: "Service not found" }, 404);
    }
    // Stop service if running before updating
    if (service.status === "running") {
      serviceStore.stopService(id);
    }
    const updated = serviceStore.update(id, body);
    return c.json(updated);
  });

  api.get("/services/discover", async (c) => {
    if (!serviceStore) return c.json({ error: "Service store not available" }, 503);
    const discovered = await serviceStore.discoverServices();
    return c.json(discovered);
  });

  api.post("/services/:id/start", async (c) => {
    if (!serviceStore) return c.json({ error: "Service store not available" }, 503);
    const service = serviceStore.get(c.req.param("id"));
    if (!service) return c.json({ error: "Not found" }, 404);
    const ok = await serviceStore.startService(c.req.param("id"));
    return c.json({ ok, service: serviceStore.get(c.req.param("id")) });
  });

  api.post("/services/:id/stop", (c) => {
    if (!serviceStore) return c.json({ error: "Service store not available" }, 503);
    const service = serviceStore.get(c.req.param("id"));
    if (!service) return c.json({ error: "Not found" }, 404);
    const ok = serviceStore.stopService(c.req.param("id"));
    return c.json({ ok, service: serviceStore.get(c.req.param("id")) });
  });

  api.post("/services/:id/restart", async (c) => {
    if (!serviceStore) return c.json({ error: "Service store not available" }, 503);
    const service = serviceStore.get(c.req.param("id"));
    if (!service) return c.json({ error: "Not found" }, 404);
    const ok = await serviceStore.restartService(c.req.param("id"));
    return c.json({ ok, service: serviceStore.get(c.req.param("id")) });
  });

  api.get("/services/:id/logs", (c) => {
    if (!serviceStore) return c.json({ error: "Service store not available" }, 503);
    const service = serviceStore.get(c.req.param("id"));
    if (!service) return c.json({ error: "Not found" }, 404);
    const lines = parseInt(c.req.query("lines") || "100");
    const logs = serviceStore.getServiceLogs(c.req.param("id"), lines);
    return c.text(logs);
  });

  api.delete("/services/:id", (c) => {
    if (!serviceStore) return c.json({ error: "Service store not available" }, 503);
    const deleted = serviceStore.delete(c.req.param("id"));
    if (!deleted) return c.json({ error: "Not found" }, 404);
    return c.json({ ok: true });
  });

  // ── iTerm2 routes — served by the internal iterm_bridge.py subprocess ────────
  // No auth needed: the bridge binds to 127.0.0.1 (loopback only).

  const BRIDGE = `http://127.0.0.1:${process.env.ITERM_BRIDGE_PORT || "8765"}`;

  async function bridgeFetch(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${BRIDGE}${path}`, init);
  }

  api.get("/iterm/sessions", async (c) => {
    try {
      const res = await bridgeFetch("/sessions");
      if (!res.ok) return c.json({ sessions: [], error: "bridge unavailable" }, 200);
      return c.json(await res.json());
    } catch (e) {
      return c.json({ sessions: [], error: String(e) }, 200);
    }
  });

  api.get("/iterm/session/:id/content", async (c) => {
    const id = c.req.param("id");
    const lines = c.req.query("lines") || "120";
    try {
      const res = await bridgeFetch(`/session/${id}/content?lines=${lines}`);
      if (!res.ok) return c.json({ error: "bridge error" }, res.status as 404 | 500);
      return c.json(await res.json());
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  api.post("/iterm/session/:id/send", async (c) => {
    const id = c.req.param("id");
    const body = (await c.req.json()) as { text: string };
    try {
      const res = await bridgeFetch(`/session/${id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: body.text }),
      });
      if (!res.ok) return c.json({ error: "bridge error" }, res.status as 404 | 500);
      return c.json(await res.json());
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // AI summary title — fetch terminal content then ask aiserv
  api.get("/iterm/session/:id/title", async (c) => {
    const id = c.req.param("id");
    const sessionName = c.req.query("name") || "";
    try {
      const contentRes = await bridgeFetch(`/session/${id}/content?lines=30`);
      if (!contentRes.ok) return c.json({ title: sessionName }, 200);
      const contentData = (await contentRes.json()) as { content?: string };
      const rawContent = (contentData.content || "").trim();
      if (!rawContent) return c.json({ title: sessionName || "Empty session" }, 200);

      const aiRes = await fetch("http://127.0.0.1:4000/v1/messages", {
        method: "POST",
        signal: AbortSignal.timeout(8000), // don't hang if aiserv is slow
        headers: {
          "Content-Type": "application/json",
          "x-api-key": "sk-aiserv-local",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku",
          max_tokens: 30,
          messages: [{
            role: "user",
            content: `Terminal session "${sessionName}" recent output:\n\`\`\`\n${rawContent.slice(-800)}\n\`\`\`\n\nRespond with ONLY a concise 3-6 word task description (no punctuation). Examples: "Running bun dev server", "Git push proxyserv repo", "Claude Code coding session"`,
          }],
        }),
      });
      if (aiRes.ok) {
        const aiData = (await aiRes.json()) as { content?: { type: string; text: string }[] };
        const title = aiData.content?.[0]?.text?.trim().slice(0, 50) || sessionName;
        return c.json({ title });
      }
    } catch {}
    return c.json({ title: sessionName }, 200);
  });

  // ── API config routes ──────────────────────────────────────────────────────

  api.get("/config", (c) => {
    const info = detectApiProvider();
    return c.json(info);
  });

  api.post("/config", async (c) => {
    const { provider } = (await c.req.json()) as { provider: ApiProvider };
    if (provider !== "anthropic" && provider !== "openai") {
      return c.json({ error: "provider must be 'anthropic' or 'openai'" }, 400);
    }
    setPreferredProvider(provider);
    return c.json(detectApiProvider());
  });

  return api;
}
