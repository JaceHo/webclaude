/**
 * FeishuBridge – integrates Feishu DM conversations as persistent webclaude
 * sessions.
 *
 * Responsibilities:
 *  1. On startup: for each entry in ~/.openclaw/config.json#feishu.sessions,
 *     find or create a webclaude Session with feishuDmInfo populated.
 *  2. Poll Feishu every N ms for new inbound messages; append them to the
 *     message store and broadcast via WebSocket so the UI updates live.
 *  3. If auto_reply=true for a session, invoke the Claude Agent SDK and send
 *     the assistant's reply back to Feishu.
 *  4. Expose helpers so WSHandler can forward manually-typed webclaude replies
 *     back to Feishu for non-auto-reply sessions.
 */

import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { FeishuSessionConfig } from "../openclaw-config.js";
import { FeishuClient } from "./feishu-client.js";
import type { SessionStore } from "../session-store.js";
import type { MessageStore } from "../message-store.js";
import type { ConnectionManager } from "../connection-manager.js";
import type { AgentRunner } from "../agent-runner.js";
import type { PersistedMessage } from "@webclaude/shared";
import { AVAILABLE_MODELS } from "@webclaude/shared";
import { extractAssistantText } from "../agent-event-utils.js";

// ── State persistence ──────────────────────────────────────────────────────────

const DATA_DIR = join(import.meta.dir, "../../../data");
const STATE_FILE = join(DATA_DIR, "feishu-state.json");

/** Title prefix for Feishu DM sessions so they stand out in the sidebar. */
const FEISHU_TITLE_PREFIX = "✈ ";

/** Default model for newly created Feishu sessions. */
const DEFAULT_MODEL = AVAILABLE_MODELS[0].id;

interface FeishuState {
  /** sessionId → array of processed Feishu message_ids (capped at 500). */
  processedIds: Record<string, string[]>;
  /** sessionId → Unix ms timestamp of last seen message. */
  lastSeenAt: Record<string, number>;
  /** Cached bot open_id — avoids an API call on every restart. */
  botOpenId?: string;
}

function loadState(): FeishuState {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf-8")) as FeishuState;
  } catch {
    // Missing or corrupt – start fresh
    return { processedIds: {}, lastSeenAt: {} };
  }
}

/** Debounced handle – prevents synchronous writeFileSync blocking the event loop. */
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSaveState(state: FeishuState): void {
  if (saveTimer) return; // already scheduled
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      mkdirSync(DATA_DIR, { recursive: true });
      writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
    } catch (err) {
      console.warn("[FeishuBridge] Could not save state:", err);
    }
  }, 200);
}

// ── Bridge ────────────────────────────────────────────────────────────────────

/** Mapping from webclaude sessionId → Feishu chat_id */
type FeishuSessionMap = Map<string, string>;

export class FeishuBridge {
  private client: FeishuClient;
  private botOpenId = "";
  private sessionMap: FeishuSessionMap = new Map();
  private state: FeishuState = { processedIds: {}, lastSeenAt: {} };
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pollIntervalMs: number;

  constructor(
    private readonly appId: string,
    private readonly appSecret: string,
    pollIntervalMs: number,
    private readonly sessionConfigs: FeishuSessionConfig[],
    private readonly sessionStore: SessionStore,
    private readonly messageStore: MessageStore,
    private readonly connectionManager: ConnectionManager,
    private readonly agentRunner: AgentRunner,
  ) {
    this.client = new FeishuClient(appId, appSecret);
    this.pollIntervalMs = Math.max(pollIntervalMs, 1000);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Call once after server starts. Resolves sessions then starts polling. */
  async initialize(): Promise<void> {
    this.state = loadState();

    // Use cached bot open_id from state if available — avoids an API round-trip
    // on every restart and prevents hangs caused by stale TCP connections.
    if (this.state.botOpenId) {
      this.botOpenId = this.state.botOpenId;
      console.log("[FeishuBridge] Using cached bot open_id:", this.botOpenId);
    } else {
      try {
        this.botOpenId = await this.client.getBotOpenId();
        console.log("[FeishuBridge] Authenticated as bot:", this.botOpenId);
        // Persist so future restarts skip this call
        this.state.botOpenId = this.botOpenId;
        scheduleSaveState(this.state);
      } catch (err) {
        console.error("[FeishuBridge] Failed to fetch bot identity:", err);
        return;
      }
    }

    // If no specific sessions configured, fetch all bot chats
    if (this.sessionConfigs.length === 0) {
      console.log("[FeishuBridge] No sessions configured, fetching all bot chats...");

      // Create a placeholder session so Feishu shows in sidebar
      await this.bootstrapSessionFromChat("placeholder", "Feishu DM");

      try {
        const allChats = await this.client.getAllChats();
        console.log(`[FeishuBridge] Found ${allChats.length} chat(s)`);

        // If we have real chats, replace the placeholder
        if (allChats.length > 0) {
          // Remove placeholder and create real sessions
          const placeholder = this.sessionStore.getAll().find(s => s.feishuDmInfo?.chatId === "placeholder");
          if (placeholder) {
            this.sessionStore.delete(placeholder.id);
            this.sessionMap.delete(placeholder.id);
          }

          for (const chat of allChats) {
            await this.bootstrapSessionFromChat(chat.chatId, chat.name);
          }
        }
      } catch (err) {
        console.error("[FeishuBridge] Failed to fetch chats:", err);
      }
    } else {
      // Bootstrap all configured sessions concurrently
      await Promise.all(this.sessionConfigs.map((cfg) => this.bootstrapSession(cfg)));
    }

    this.startPolling();
    console.log(
      `[FeishuBridge] Polling ${this.sessionMap.size} session(s) every ${this.pollIntervalMs} ms`,
    );
  }

  /** Bootstrap a session from a chat ID (auto-discovery mode). */
  private async bootstrapSessionFromChat(chatId: string, name: string): Promise<void> {
    // Find existing session for this chat
    const existing = this.sessionStore
      .getAll()
      .find((s) => s.feishuDmInfo?.chatId === chatId);

    const resolvedCwd = process.env.HOME || process.cwd();

    let sessionId: string;
    if (existing) {
      sessionId = existing.id;
    } else {
      const session = this.sessionStore.create({
        title: `✈ ${name}`,
        model: "claude-sonnet-4-6",
        cwd: resolvedCwd,
      });
      sessionId = session.id;
      this.sessionStore.update(sessionId, {
        feishuDmInfo: {
          chatId,
          displayName: name,
          autoReply: true,
        },
      });
    }

    this.sessionMap.set(sessionId, chatId);

    // Load message history on first bootstrap (no persisted messages yet)
    if (chatId !== "placeholder") {
      const existing_msgs = this.messageStore.getAll(sessionId);
      if (existing_msgs.length === 0) {
        console.log(`[FeishuBridge] Loading message history for ${name}...`);
        await this.loadHistory(sessionId, chatId, Date.now() - 30 * 24 * 60 * 60 * 1000, Date.now());
      }
    }

    // Broadcast
    const session = this.sessionStore.get(sessionId);
    if (session) {
      this.connectionManager.broadcastAll({ type: "session_update", session });
    }
  }

  /**
   * Public: fetch messages from Feishu for a session older than `beforeMs`
   * and store them in the message store. Used by the "Load more" API endpoint.
   */
  async loadHistoryBefore(sessionId: string, beforeMs: number): Promise<void> {
    const chatId = this.sessionMap.get(sessionId);
    if (!chatId || chatId === "placeholder") return;
    const startMs = beforeMs - 7 * 24 * 60 * 60 * 1000;
    await this.loadHistory(sessionId, chatId, startMs, beforeMs);
  }

  private async loadHistory(sessionId: string, chatId: string, startMs: number, endMs: number): Promise<void> {
    try {
      const messages = await this.client.getMessageHistory(chatId, startMs, endMs);
      for (const msg of messages) {
        const role = msg.senderId === this.botOpenId ? "assistant" : "user";
        const persisted: PersistedMessage = {
          id: msg.messageId,
          role,
          blocks: [{ type: "text", text: msg.text }],
          parentToolUseId: null,
          timestamp: new Date(msg.createdAt).toISOString(),
        };
        this.messageStore.append(sessionId, persisted);
      }
      console.log(`[FeishuBridge] Stored ${messages.length} historical messages for session ${sessionId}`);
    } catch (err) {
      console.warn(`[FeishuBridge] Failed to load history for session ${sessionId}:`, err);
    }
  }

  /** Graceful shutdown – clears the poll interval. */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Returns true if this webclaude session is backed by a Feishu DM.
   * Used by WSHandler to decide whether to forward replies.
   */
  isFeishuSession(sessionId: string): boolean {
    return this.sessionMap.has(sessionId);
  }

  /**
   * Send text to Feishu on behalf of a webclaude session.
   * Safe to call even if sessionId is not a Feishu session (no-op).
   */
  async forwardReplyToFeishu(
    sessionId: string,
    text: string,
  ): Promise<void> {
    const chatId = this.sessionMap.get(sessionId);
    if (!chatId || !text.trim()) return;
    try {
      const msgId = await this.client.sendTextMessage(chatId, text);
      // Mark our own sent message as processed so we don't loop on the next poll
      this.markProcessed(sessionId, msgId);
      scheduleSaveState(this.state);
    } catch (err) {
      console.error(
        `[FeishuBridge] Failed to send reply for session ${sessionId}:`,
        err,
      );
    }
  }

  // ── Session bootstrap ───────────────────────────────────────────────────────

  private async bootstrapSession(cfg: FeishuSessionConfig): Promise<void> {
    if (!cfg.chat_id && !cfg.open_id) {
      console.warn(
        "[FeishuBridge] Session config missing both chat_id and open_id – skipped:",
        cfg.name,
      );
      return;
    }

    // Resolve chat_id — prefer using the cached chatId from a persisted session
    // with this open_id, to avoid creating a new chat on every restart.
    let chatId = cfg.chat_id ?? "";
    if (!chatId && cfg.open_id) {
      // Check persisted sessions by open_id first (avoids an API call + prevents duplicates)
      const byOpenId = this.sessionStore.getAll().find(
        (s) => s.feishuDmInfo?.openId === cfg.open_id && s.feishuDmInfo?.chatId && s.feishuDmInfo.chatId !== "placeholder",
      );
      if (byOpenId) {
        chatId = byOpenId.feishuDmInfo!.chatId;
        console.log(`[FeishuBridge] Using cached chat_id for ${cfg.name}: ${chatId}`);
      } else {
        try {
          chatId = await this.client.resolveP2PChatId(cfg.open_id);
          console.log(`[FeishuBridge] Resolved chat_id for ${cfg.name}: ${chatId}`);
        } catch (err) {
          console.error(`[FeishuBridge] Could not resolve chat_id for ${cfg.name}:`, err);
          return;
        }
      }
    }

    // Find an existing webclaude session already linked to this chatId
    let existingSessionId: string | undefined;
    for (const [sid, cid] of this.sessionMap) {
      if (cid === chatId) { existingSessionId = sid; break; }
    }
    if (!existingSessionId) {
      for (const s of this.sessionStore.getAll()) {
        if (s.feishuDmInfo?.chatId === chatId) { existingSessionId = s.id; break; }
      }
    }

    const resolvedCwd =
      cfg.cwd === "~" || cfg.cwd === "~/" ? homedir() : cfg.cwd ?? homedir();

    let sessionId: string;
    if (existingSessionId) {
      sessionId = existingSessionId;
      // Refresh display metadata in case config changed
      this.sessionStore.update(sessionId, {
        title: `${FEISHU_TITLE_PREFIX}${cfg.name}`,
        model: cfg.model ?? this.sessionStore.get(sessionId)?.model ?? DEFAULT_MODEL,
        cwd: resolvedCwd,
        feishuDmInfo: {
          chatId,
          openId: cfg.open_id ?? this.sessionStore.get(sessionId)?.feishuDmInfo?.openId,
          displayName: cfg.name,
          autoReply: cfg.auto_reply ?? true,
        },
      });
      console.log(`[FeishuBridge] Reusing session ${sessionId} for ${cfg.name}`);
    } else {
      const session = this.sessionStore.create({
        title: `${FEISHU_TITLE_PREFIX}${cfg.name}`,
        model: cfg.model ?? DEFAULT_MODEL,
        cwd: resolvedCwd,
      });
      sessionId = session.id;
      this.sessionStore.update(sessionId, {
        feishuDmInfo: {
          chatId,
          openId: cfg.open_id,
          displayName: cfg.name,
          autoReply: cfg.auto_reply ?? true,
        },
      });
      console.log(`[FeishuBridge] Created new session ${sessionId} for ${cfg.name}`);
    }

    this.sessionMap.set(sessionId, chatId);

    // Broadcast so all clients' sidebars update immediately
    const session = this.sessionStore.get(sessionId);
    if (session) {
      this.connectionManager.broadcastAll({ type: "session_update", session });
    }
  }

  // ── Polling ─────────────────────────────────────────────────────────────────

  private startPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => {
      for (const [sessionId, chatId] of this.sessionMap) {
        // Skip placeholder sessions
        if (chatId === "placeholder") continue;
        this.pollSession(sessionId, chatId).catch((err) => {
          // AbortError = our own 15s fetchWithTimeout firing; ignore it silently
          if (err?.name === "AbortError" || err?.code === 20) return;
          // Self-signed cert / TLS errors: log concisely, not as full objects
          const msg = err?.message ?? String(err);
          if (msg.includes("SELF_SIGNED") || msg.includes("certificate") || msg.includes("cert")) {
            console.warn(`[FeishuBridge] Poll TLS error for ${sessionId}: ${msg}`);
            return;
          }
          console.error(`[FeishuBridge] Poll error for session ${sessionId}:`, msg);
        });
      }
    }, this.pollIntervalMs);
  }

  private async pollSession(sessionId: string, chatId: string): Promise<void> {
    // Poll from 24h ago on first run, then from the last seen timestamp
    const since = this.state.lastSeenAt[sessionId] ?? Date.now() - 86_400_000;

    const messages = await this.client.getMessagesSince(chatId, since - 1000);
    if (messages.length === 0) return;

    let newMessages = 0;
    for (const msg of messages) {
      if (this.isProcessed(sessionId, msg.messageId)) continue;
      if (msg.senderId === this.botOpenId) {
        this.markProcessed(sessionId, msg.messageId);
        this.updateLastSeen(sessionId, msg.createdAt);
        continue;
      }

      await this.handleIncomingMessage(sessionId, msg.text, msg.messageId, msg.createdAt);
      this.markProcessed(sessionId, msg.messageId);
      this.updateLastSeen(sessionId, msg.createdAt);
      newMessages++;
    }

    if (newMessages > 0) {
      scheduleSaveState(this.state);
    }
  }

  // ── Incoming message handling ───────────────────────────────────────────────

  private async handleIncomingMessage(
    sessionId: string,
    text: string,
    feishuMsgId: string,
    createdAt: number,
  ): Promise<void> {
    console.log(`[FeishuBridge] Incoming message in session ${sessionId} (${text.length} chars)`);

    // Persist as user message
    const userMsg: PersistedMessage = {
      id: feishuMsgId, // stable Feishu message_id keeps dedup across restarts
      role: "user",
      blocks: [{ type: "text", text }],
      parentToolUseId: null,
      timestamp: new Date(createdAt).toISOString(),
    };
    this.messageStore.append(sessionId, userMsg);

    const session = this.sessionStore.get(sessionId);
    if (!session) return;

    // Increment message count + update feishuDmInfo in a single update call
    const updated = this.sessionStore.update(sessionId, {
      messageCount: session.messageCount + 1,
      feishuDmInfo: session.feishuDmInfo
        ? { ...session.feishuDmInfo }
        : undefined,
    });

    if (updated) {
      // broadcastAll so all clients' sidebars reflect the new message activity
      this.connectionManager.broadcastAll({ type: "session_update", session: updated });
    }

    // Send user message to subscribed UI (chat window)
    this.connectionManager.broadcast(sessionId, {
      type: "agent_event",
      sessionId,
      event: { type: "feishu_user_message", message: userMsg },
    });

    // Auto-reply: run Claude and send response back to Feishu
    if (session.feishuDmInfo?.autoReply) {
      await this.runAutoReply(sessionId, text, session.model, session.cwd);
    }
  }

  private async runAutoReply(
    sessionId: string,
    text: string,
    model: string,
    cwd: string,
  ): Promise<void> {
    if (this.agentRunner.isRunning(sessionId)) {
      console.log(`[FeishuBridge] Agent already running for ${sessionId}, skipping auto-reply`);
      return;
    }

    // Use the return value from updateStatus rather than a second get()
    const runningSession = this.sessionStore.updateStatus(sessionId, "running");
    if (runningSession) {
      this.connectionManager.broadcastAll({ type: "session_update", session: runningSession });
    }
    this.connectionManager.broadcast(sessionId, { type: "stream_start", sessionId });

    // Collect assistant text to forward to Feishu
    const assistantTextParts: string[] = [];

    await this.agentRunner.run(sessionId, text, {
      model,
      cwd,
      onEvent: (event) => {
        this.connectionManager.broadcast(sessionId, { type: "agent_event", sessionId, event });
        // Shared helper – no inline duplication
        assistantTextParts.push(...extractAssistantText(event));
      },
      onEnd: async (cost) => {
        if (cost) this.sessionStore.addCost(sessionId, cost.totalCost);
        const endSession = this.sessionStore.updateStatus(sessionId, "idle");
        if (endSession) {
          this.connectionManager.broadcastAll({ type: "session_update", session: endSession });
        }
        this.connectionManager.broadcast(sessionId, { type: "stream_end", sessionId, cost });

        const replyText = assistantTextParts.join("").trim();
        if (replyText) {
          await this.forwardReplyToFeishu(sessionId, replyText);
        }
      },
      onError: (err, willRetry) => {
        if (willRetry) {
          this.connectionManager.broadcast(sessionId, {
            type: "error",
            sessionId,
            message: `${err.message} — retrying...`,
          });
          return;
        }
        const errSession = this.sessionStore.updateStatus(sessionId, "error");
        if (errSession) {
          this.connectionManager.broadcastAll({ type: "session_update", session: errSession });
        }
        this.connectionManager.broadcast(sessionId, { type: "error", sessionId, message: err.message });
        this.connectionManager.broadcast(sessionId, { type: "stream_end", sessionId });
        // Auto-recover after 2s
        setTimeout(() => {
          const cur = this.sessionStore.get(sessionId);
          if (cur?.status === "error") {
            const rec = this.sessionStore.updateStatus(sessionId, "idle");
            if (rec) {
              this.connectionManager.broadcastAll({ type: "session_update", session: rec });
            }
          }
        }, 2000);
      },
    });
  }

  // ── State helpers ───────────────────────────────────────────────────────────

  private isProcessed(sessionId: string, msgId: string): boolean {
    return this.state.processedIds[sessionId]?.includes(msgId) ?? false;
  }

  private markProcessed(sessionId: string, msgId: string): void {
    if (!this.state.processedIds[sessionId]) {
      this.state.processedIds[sessionId] = [];
    }
    const ids = this.state.processedIds[sessionId];
    if (!ids.includes(msgId)) {
      ids.push(msgId);
      // Keep only the most recent 500 IDs to cap memory / file size
      if (ids.length > 500) {
        this.state.processedIds[sessionId] = ids.slice(-500);
      }
    }
  }

  private updateLastSeen(sessionId: string, timestampMs: number): void {
    const prev = this.state.lastSeenAt[sessionId] ?? 0;
    if (timestampMs > prev) {
      this.state.lastSeenAt[sessionId] = timestampMs;
    }
  }

  // ── Status for API ──────────────────────────────────────────────────────────

  getStatus(): {
    enabled: boolean;
    sessions: Array<{ sessionId: string; title: string }>;
    pollIntervalMs: number;
  } {
    const sessions = [...this.sessionMap.keys()].map((sid) => ({
      sessionId: sid,
      title: this.sessionStore.get(sid)?.title ?? sid,
    }));
    return { enabled: true, sessions, pollIntervalMs: this.pollIntervalMs };
  }
}
