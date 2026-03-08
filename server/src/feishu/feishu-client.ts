/** Feishu (Lark) Open-Platform HTTP client. */

const BASE = "https://open.feishu.cn/open-apis";

// ── Raw API types ─────────────────────────────────────────────────────────────

interface TenantTokenResponse {
  code: number;
  msg?: string;
  tenant_access_token: string;
  expire: number;
}

interface ApiResponse<T = unknown> {
  code: number;
  msg?: string;
  data?: T;
}

export interface FeishuRawMessage {
  message_id: string;
  root_id?: string;
  parent_id?: string;
  thread_id?: string;
  msg_type: string;
  create_time: string; // Unix ms as string
  update_time?: string;
  deleted?: boolean;
  updated?: boolean;
  chat_id?: string;
  sender: {
    id: string;
    id_type: string;
    sender_type: string;
    tenant_key?: string;
  };
  body: {
    content: string; // JSON string
  };
  mentions?: Array<{
    key: string;
    id: { open_id: string };
    name: string;
    tenant_key?: string;
  }>;
}

// ── Parsed message for bridge consumption ─────────────────────────────────────

export interface FeishuMessage {
  messageId: string;
  chatId: string;
  senderId: string;
  /** Unix timestamp in ms */
  createdAt: number;
  text: string;
  msgType: string;
  isDeleted: boolean;
}

// ── Client ───────────────────────────────────────────────────────────────────

export class FeishuClient {
  private token: string | null = null;
  /** Unix timestamp (seconds) at which the current token expires. */
  private tokenExpiresAt = 0;

  constructor(
    private readonly appId: string,
    private readonly appSecret: string,
  ) {}

  /** Wrapper that aborts the fetch after `timeoutMs` (default 15 s). */
  private async fetchWithTimeout(
    url: string,
    init?: RequestInit,
    timeoutMs = 15_000,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  // ── Auth ────────────────────────────────────────────────────────────────────

  private async fetchToken(): Promise<void> {
    const res = await this.fetchWithTimeout(
      `${BASE}/auth/v3/tenant_access_token/internal`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app_id: this.appId, app_secret: this.appSecret }),
      },
    );
    const data = (await res.json()) as TenantTokenResponse;
    if (data.code !== 0) {
      throw new Error(
        `[Feishu] Auth failed: code=${data.code} msg=${data.msg ?? ""}`,
      );
    }
    this.token = data.tenant_access_token;
    // Subtract 60 s to refresh slightly before real expiry
    this.tokenExpiresAt = Math.floor(Date.now() / 1000) + data.expire - 60;
    console.log("[Feishu] Token refreshed, expires in", data.expire, "s");
  }

  private async getToken(): Promise<string> {
    if (!this.token || Date.now() / 1000 >= this.tokenExpiresAt) {
      await this.fetchToken();
    }
    return this.token!;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    return {
      Authorization: `Bearer ${await this.getToken()}`,
      "Content-Type": "application/json",
    };
  }

  // ── Chat resolution ─────────────────────────────────────────────────────────

  /**
   * Given a user's open_id, find (or create) the P2P DM chat between the bot
   * and that user. Returns the resolved chat_id.
   *
   * Feishu API: POST /im/v1/chats  (chat_mode inferred as p2p for single user)
   * If the bot already has a P2P chat with the user it returns the existing one.
   */
  async resolveP2PChatId(openId: string): Promise<string> {
    const headers = await this.authHeaders();
    const res = await this.fetchWithTimeout(
      `${BASE}/im/v1/chats?user_id_type=open_id`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ user_id_list: [openId], chat_mode: "p2p" }),
      },
    );
    const data = (await res.json()) as ApiResponse<{ chat_id: string }>;
    // code 232004 = "chat already exists" – Feishu returns the existing one
    if (data.code !== 0 && data.code !== 232004) {
      throw new Error(
        `[Feishu] resolveP2PChatId failed: code=${data.code} msg=${data.msg ?? ""}`,
      );
    }
    if (!data.data?.chat_id) {
      throw new Error("[Feishu] resolveP2PChatId: empty chat_id in response");
    }
    return data.data.chat_id;
  }

  // ── Message fetching ────────────────────────────────────────────────────────

  /**
   * Fetch messages in a chat created after `sinceMs` (Unix milliseconds).
   * Returns newest-first raw messages filtered to non-deleted text/post items.
   */
  async getMessagesSince(
    chatId: string,
    sinceMs: number,
  ): Promise<FeishuMessage[]> {
    const headers = await this.authHeaders();
    // Feishu start_time is in Unix seconds
    const startTime = Math.floor(sinceMs / 1000);

    const url =
      `${BASE}/im/v1/messages` +
      `?container_id_type=chat` +
      `&container_id=${encodeURIComponent(chatId)}` +
      `&start_time=${startTime}` +
      `&sort_type=ByCreateTimeAsc` +
      `&page_size=50`;

    const res = await this.fetchWithTimeout(url, { headers });
    const data = (await res.json()) as ApiResponse<{
      items?: FeishuRawMessage[];
    }>;

    if (data.code !== 0) {
      throw new Error(
        `[Feishu] getMessages failed: code=${data.code} msg=${data.msg ?? ""}`,
      );
    }

    const items = data.data?.items ?? [];
    return items
      .filter((m) => !m.deleted)
      .map((m) => this.parseMessage(m, chatId));
  }

  private parseMessage(raw: FeishuRawMessage, fallbackChatId: string): FeishuMessage {
    let text = "";
    try {
      const body = JSON.parse(raw.body.content) as Record<string, unknown>;
      if (raw.msg_type === "text") {
        text = (body.text as string) ?? "";
      } else if (raw.msg_type === "post") {
        // Rich text – extract plain text from title + content
        const lang = (body.zh_cn ?? body.en_us ?? Object.values(body)[0]) as {
          title?: string;
          content?: Array<Array<{ tag: string; text?: string }>>;
        };
        const lines: string[] = [];
        if (lang?.title) lines.push(lang.title);
        for (const line of lang?.content ?? []) {
          lines.push(
            line
              .filter((n) => n.tag === "text")
              .map((n) => n.text ?? "")
              .join(""),
          );
        }
        text = lines.join("\n").trim();
      } else {
        text = `[${raw.msg_type} message]`;
      }
    } catch {
      text = raw.body.content;
    }

    return {
      messageId: raw.message_id,
      chatId: raw.chat_id ?? fallbackChatId,
      senderId: raw.sender.id,
      createdAt: parseInt(raw.create_time, 10),
      text,
      msgType: raw.msg_type,
      isDeleted: raw.deleted ?? false,
    };
  }

  // ── Sending ─────────────────────────────────────────────────────────────────

  /**
   * Send a plain-text message to a Feishu chat.
   * Uses `receive_id_type=chat_id` so it works for both group and P2P chats.
   */
  async sendTextMessage(chatId: string, text: string): Promise<string> {
    const headers = await this.authHeaders();
    const res = await this.fetchWithTimeout(
      `${BASE}/im/v1/messages?receive_id_type=chat_id`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          receive_id: chatId,
          msg_type: "text",
          content: JSON.stringify({ text }),
        }),
      },
    );
    const data = (await res.json()) as ApiResponse<{ message_id: string }>;
    if (data.code !== 0) {
      throw new Error(
        `[Feishu] sendMessage failed: code=${data.code} msg=${data.msg ?? ""}`,
      );
    }
    return data.data?.message_id ?? "";
  }

  // ── Bot identity ─────────────────────────────────────────────────────────────

  /** Returns the bot's own open_id (used to filter out bot's own messages). */
  async getBotOpenId(): Promise<string> {
    const headers = await this.authHeaders();
    const res = await this.fetchWithTimeout(`${BASE}/bot/v3/info`, { headers });
    const raw = await res.json();
    // Response is { code, msg, bot: { open_id, ... } } - no data wrapper!
    if (raw.code !== 0) {
      throw new Error(
        `[Feishu] getBotInfo failed: code=${raw.code} msg=${raw.msg ?? ""}`,
      );
    }
    const openId = raw.bot?.open_id ?? "";
    console.log("[Feishu] Bot open_id:", openId);
    return openId;
  }

  /**
   * Fetch ALL messages in a time range with pagination (for history loading).
   * Returns messages in ascending creation order.
   */
  async getMessageHistory(
    chatId: string,
    startMs: number,
    endMs: number,
  ): Promise<FeishuMessage[]> {
    const headers = await this.authHeaders();
    const startTime = Math.floor(startMs / 1000);
    const endTime = Math.floor(endMs / 1000);
    const all: FeishuMessage[] = [];
    let pageToken = "";

    do {
      let url =
        `${BASE}/im/v1/messages` +
        `?container_id_type=chat` +
        `&container_id=${encodeURIComponent(chatId)}` +
        `&start_time=${startTime}` +
        `&end_time=${endTime}` +
        `&sort_type=ByCreateTimeAsc` +
        `&page_size=50`;
      if (pageToken) url += `&page_token=${pageToken}`;

      const res = await this.fetchWithTimeout(url, { headers });
      const data = (await res.json()) as ApiResponse<{
        items?: FeishuRawMessage[];
        page_token?: string;
        has_more?: boolean;
      }>;

      if (data.code !== 0) {
        throw new Error(
          `[Feishu] getMessageHistory failed: code=${data.code} msg=${data.msg ?? ""}`,
        );
      }

      all.push(
        ...(data.data?.items ?? [])
          .filter((m) => !m.deleted)
          .map((m) => this.parseMessage(m, chatId)),
      );

      pageToken = data.data?.has_more ? (data.data.page_token ?? "") : "";
    } while (pageToken);

    return all;
  }

  /** Get all P2P chats the bot is in (for receiving DMs). */
  async getAllChats(): Promise<Array<{ chatId: string; name: string }>> {
    const headers = await this.authHeaders();
    const chats: Array<{ chatId: string; name: string }> = [];
    let pageToken = "";

    do {
      let url = `${BASE}/im/v1/chats?page_size=50`;
      if (pageToken) {
        url += `&page_token=${pageToken}`;
      }

      const res = await this.fetchWithTimeout(url, { headers });
      const data = (await res.json()) as ApiResponse<{
        items?: Array<{ chat_id: string; name: string }>;
        page_token?: string;
      }>;

      if (data.code !== 0) {
        throw new Error(
          `[Feishu] getAllChats failed: code=${data.code} msg=${data.msg ?? ""}`,
        );
      }

      if (data.data?.items) {
        for (const chat of data.data.items) {
          // Only include P2P chats (direct messages)
          if (chat.chat_id.startsWith("oc_")) {
            chats.push({ chatId: chat.chat_id, name: chat.name || "DM" });
          }
        }
      }

      pageToken = data.data?.page_token ?? "";
    } while (pageToken);

    return chats;
  }
}
