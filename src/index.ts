interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
}

type Target = {
  id: number;
  title: string;
  chat_id: string;
  type: "channel" | "group";
  enabled: number;
  created_at: string;
  messages?: ScheduledMessage[];
};

type ScheduledMessage = {
  id: number;
  target_id: number;
  body: string;
  scheduled_at: string;
  status: "pending" | "posting" | "posted" | "failed";
  attempts: number;
  posted_at: string | null;
  telegram_message_id: number | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  target_title?: string;
  chat_id?: string;
};

type TelegramSendResult = {
  ok: boolean;
  result?: { message_id: number };
  description?: string;
};

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return htmlResponse(APP_HTML);
    }

    if (url.pathname === "/api/health") {
      return json({ ok: true });
    }

    if (url.pathname === "/api/bot" && request.method === "GET") {
      return getBot(env);
    }

    if (url.pathname === "/api/targets" && request.method === "GET") {
      return listTargets(env);
    }

    if (url.pathname === "/api/targets" && request.method === "POST") {
      return createTarget(request, env);
    }

    const targetMatch = url.pathname.match(/^\/api\/targets\/(\d+)$/);
    if (targetMatch && request.method === "DELETE") {
      return deleteTarget(Number(targetMatch[1]), env);
    }

    if (url.pathname === "/api/messages" && request.method === "GET") {
      const targetId = url.searchParams.get("targetId");
      return listMessages(env, targetId ? Number(targetId) : undefined);
    }

    if (url.pathname === "/api/messages" && request.method === "POST") {
      return createMessage(request, env);
    }

    const messagePostMatch = url.pathname.match(/^\/api\/messages\/(\d+)\/post$/);
    if (messagePostMatch && request.method === "POST") {
      return postOneMessage(Number(messagePostMatch[1]), env);
    }

    const messageMatch = url.pathname.match(/^\/api\/messages\/(\d+)$/);
    if (messageMatch && request.method === "DELETE") {
      return deleteMessage(Number(messageMatch[1]), env);
    }

    return json({ error: "Not found" }, 404);
  },

  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await postDueMessages(env);
  }
};

async function getBot(env: Env): Promise<Response> {
  const result = await telegramRequest(env, "getMe", {});
  if (!result.ok) {
    return json({ ok: false, error: result.description ?? "Telegram bot check failed" }, 502);
  }
  return json({ ok: true, bot: result.result });
}

async function listTargets(env: Env): Promise<Response> {
  const targets = await env.DB.prepare(
    "SELECT id, title, chat_id, type, enabled, created_at FROM targets ORDER BY created_at DESC"
  ).all<Target>();

  const messages = await env.DB.prepare(
    `SELECT messages.*, targets.title AS target_title, targets.chat_id
     FROM messages
     JOIN targets ON targets.id = messages.target_id
     ORDER BY messages.scheduled_at DESC
     LIMIT 200`
  ).all<ScheduledMessage>();

  const messagesByTarget = new Map<number, ScheduledMessage[]>();
  for (const message of messages.results ?? []) {
    const list = messagesByTarget.get(message.target_id) ?? [];
    list.push(message);
    messagesByTarget.set(message.target_id, list);
  }

  return json({
    targets: (targets.results ?? []).map((target) => ({
      ...target,
      messages: messagesByTarget.get(target.id) ?? []
    }))
  });
}

async function createTarget(request: Request, env: Env): Promise<Response> {
  const input = await readJson<{ title?: string; chatId?: string; type?: string }>(request);
  const title = cleanText(input.title, 80);
  const chatId = cleanText(input.chatId, 120);
  const type = input.type === "group" ? "group" : "channel";

  if (!title || !chatId) {
    return json({ error: "Title and chat ID are required" }, 400);
  }

  await env.DB.prepare("INSERT INTO targets (title, chat_id, type) VALUES (?, ?, ?)")
    .bind(title, chatId, type)
    .run();

  return listTargets(env);
}

async function deleteTarget(id: number, env: Env): Promise<Response> {
  await env.DB.prepare("DELETE FROM targets WHERE id = ?").bind(id).run();
  return listTargets(env);
}

async function listMessages(env: Env, targetId?: number): Promise<Response> {
  const query = targetId
    ? env.DB.prepare(
        `SELECT messages.*, targets.title AS target_title, targets.chat_id
         FROM messages
         JOIN targets ON targets.id = messages.target_id
         WHERE messages.target_id = ?
         ORDER BY messages.scheduled_at DESC`
      ).bind(targetId)
    : env.DB.prepare(
        `SELECT messages.*, targets.title AS target_title, targets.chat_id
         FROM messages
         JOIN targets ON targets.id = messages.target_id
         ORDER BY messages.scheduled_at DESC
         LIMIT 200`
      );

  const messages = await query.all<ScheduledMessage>();
  return json({ messages: messages.results ?? [] });
}

async function createMessage(request: Request, env: Env): Promise<Response> {
  const input = await readJson<{ targetId?: number; body?: string; scheduledAt?: string }>(request);
  const body = cleanText(input.body, 4096);
  const scheduledAt = normalizeDate(input.scheduledAt);

  if (!input.targetId || !body || !scheduledAt) {
    return json({ error: "Target, message, and schedule time are required" }, 400);
  }

  const target = await env.DB.prepare("SELECT id FROM targets WHERE id = ? AND enabled = 1")
    .bind(input.targetId)
    .first<{ id: number }>();

  if (!target) {
    return json({ error: "Target not found" }, 404);
  }

  await env.DB.prepare("INSERT INTO messages (target_id, body, scheduled_at) VALUES (?, ?, ?)")
    .bind(input.targetId, body, scheduledAt)
    .run();

  return listTargets(env);
}

async function deleteMessage(id: number, env: Env): Promise<Response> {
  await env.DB.prepare("DELETE FROM messages WHERE id = ? AND status != 'posting'").bind(id).run();
  return listTargets(env);
}

async function postOneMessage(id: number, env: Env): Promise<Response> {
  const message = await env.DB.prepare(
    `SELECT messages.*, targets.chat_id, targets.title AS target_title
     FROM messages
     JOIN targets ON targets.id = messages.target_id
     WHERE messages.id = ?`
  ).bind(id).first<ScheduledMessage>();

  if (!message) {
    return json({ error: "Message not found" }, 404);
  }

  if (message.status === "posted") {
    return json({ error: "Message already posted" }, 409);
  }

  await sendAndRecord(message, env);
  return listTargets(env);
}

async function postDueMessages(env: Env): Promise<void> {
  const now = new Date().toISOString();
  const due = await env.DB.prepare(
    `SELECT messages.*, targets.chat_id, targets.title AS target_title
     FROM messages
     JOIN targets ON targets.id = messages.target_id
     WHERE messages.status = 'pending'
       AND messages.scheduled_at <= ?
       AND targets.enabled = 1
     ORDER BY messages.scheduled_at ASC
     LIMIT 25`
  ).bind(now).all<ScheduledMessage>();

  for (const message of due.results ?? []) {
    await sendAndRecord(message, env);
  }
}

async function sendAndRecord(message: ScheduledMessage, env: Env): Promise<void> {
  const claimed = await env.DB.prepare(
    `UPDATE messages
     SET status = 'posting', attempts = attempts + 1, updated_at = ?
     WHERE id = ? AND status IN ('pending', 'failed')`
  ).bind(new Date().toISOString(), message.id).run();

  if (claimed.meta.changes === 0) {
    return;
  }

  const sent = await telegramRequest(env, "sendMessage", {
    chat_id: message.chat_id,
    text: message.body,
    disable_web_page_preview: false
  });

  const now = new Date().toISOString();
  if (sent.ok && sent.result?.message_id) {
    await env.DB.prepare(
      `UPDATE messages
       SET status = 'posted', posted_at = ?, telegram_message_id = ?, error = NULL, updated_at = ?
       WHERE id = ?`
    ).bind(now, sent.result.message_id, now, message.id).run();
    return;
  }

  await env.DB.prepare(
    `UPDATE messages
     SET status = 'failed', error = ?, updated_at = ?
     WHERE id = ?`
  ).bind(sent.description ?? "Telegram send failed", now, message.id).run();
}

async function telegramRequest(env: Env, method: string, payload: unknown): Promise<TelegramSendResult> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return { ok: false, description: "TELEGRAM_BOT_TOKEN is not configured" };
  }

  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  return response.json<TelegramSendResult>();
}

async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    return {} as T;
  }
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizeDate(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: jsonHeaders
  });
}

function htmlResponse(body: string): Response {
  return new Response(body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

const APP_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>TG88</title>
  <style>
    :root {
      color-scheme: light;
      --background: #fafafa;
      --foreground: #171717;
      --muted: #f4f4f5;
      --muted-foreground: #71717a;
      --border: #e4e4e7;
      --primary: #18181b;
      --primary-foreground: #ffffff;
      --danger: #b91c1c;
      --success: #15803d;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--background);
      color: var(--foreground);
    }

    main {
      width: min(1180px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 28px 0;
    }

    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      margin-bottom: 24px;
    }

    h1, h2, h3, p { margin: 0; }
    h1 { font-size: 28px; font-weight: 650; letter-spacing: 0; }
    h2 { font-size: 16px; font-weight: 650; }
    h3 { font-size: 14px; font-weight: 650; }
    p, label, input, textarea, select, button { font-size: 14px; }
    small { color: var(--muted-foreground); }

    .muted { color: var(--muted-foreground); }
    .layout {
      display: grid;
      grid-template-columns: 360px 1fr;
      gap: 18px;
      align-items: start;
    }

    .panel, .target {
      border: 1px solid var(--border);
      border-radius: 8px;
      background: #ffffff;
    }

    .panel { padding: 18px; }
    .stack { display: grid; gap: 14px; }
    .field { display: grid; gap: 7px; }
    label { font-weight: 550; }

    input, textarea, select {
      width: 100%;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: #ffffff;
      padding: 10px 11px;
      color: var(--foreground);
      outline: none;
    }

    textarea {
      min-height: 118px;
      resize: vertical;
      line-height: 1.45;
    }

    input:focus, textarea:focus, select:focus {
      border-color: #a1a1aa;
      box-shadow: 0 0 0 3px rgba(24, 24, 27, 0.08);
    }

    button {
      border: 1px solid var(--border);
      border-radius: 6px;
      background: #ffffff;
      color: var(--foreground);
      padding: 9px 12px;
      font-weight: 550;
      cursor: pointer;
    }

    button.primary {
      background: var(--primary);
      border-color: var(--primary);
      color: var(--primary-foreground);
    }

    button.danger { color: var(--danger); }
    button:disabled {
      cursor: not-allowed;
      opacity: 0.55;
    }

    .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .target {
      overflow: hidden;
    }

    .target-head {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 14px;
      padding: 16px;
      border-bottom: 1px solid var(--border);
    }

    .target-title {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      min-height: 22px;
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 2px 8px;
      color: var(--muted-foreground);
      background: var(--muted);
      font-size: 12px;
      line-height: 1;
    }

    .status-posted { color: var(--success); }
    .status-failed { color: var(--danger); }
    .status-pending { color: #0369a1; }
    .status-posting { color: #a16207; }

    .messages {
      display: grid;
    }

    .message {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 14px;
      padding: 14px 16px;
      border-bottom: 1px solid var(--border);
    }

    .message:last-child { border-bottom: 0; }
    .message-body {
      white-space: pre-wrap;
      line-height: 1.45;
    }

    .empty {
      padding: 28px;
      text-align: center;
      color: var(--muted-foreground);
    }

    .actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .toast {
      min-height: 22px;
      color: var(--danger);
    }

    @media (max-width: 860px) {
      main { width: min(100vw - 24px, 720px); padding: 18px 0; }
      header { align-items: flex-start; flex-direction: column; }
      .layout { grid-template-columns: 1fr; }
      .message, .target-head { grid-template-columns: 1fr; }
      .actions { justify-content: flex-start; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>TG88</h1>
        <p class="muted">Telegram channel and group autoposter</p>
      </div>
      <button id="refresh">Refresh</button>
    </header>

    <section class="layout">
      <aside class="stack">
        <form id="target-form" class="panel stack">
          <div class="row">
            <h2>Add channel or group</h2>
            <span id="bot-status" class="badge">Bot: checking</span>
          </div>
          <div class="field">
            <label for="target-title">Name</label>
            <input id="target-title" name="title" placeholder="Announcements" required />
          </div>
          <div class="field">
            <label for="target-chat">Chat ID</label>
            <input id="target-chat" name="chatId" placeholder="@channel_or_group" required />
          </div>
          <div class="field">
            <label for="target-type">Type</label>
            <select id="target-type" name="type">
              <option value="channel">Channel</option>
              <option value="group">Group</option>
            </select>
          </div>
          <button class="primary" type="submit">Add target</button>
        </form>

        <form id="message-form" class="panel stack">
          <h2>Schedule message</h2>
          <div class="field">
            <label for="message-target">Target</label>
            <select id="message-target" name="targetId" required></select>
          </div>
          <div class="field">
            <label for="message-time">Schedule time</label>
            <input id="message-time" name="scheduledAt" type="datetime-local" required />
          </div>
          <div class="field">
            <label for="message-body">Message</label>
            <textarea id="message-body" name="body" placeholder="Write the Telegram message" required></textarea>
          </div>
          <button class="primary" type="submit">Schedule</button>
          <div id="toast" class="toast" role="status"></div>
        </form>
      </aside>

      <section id="targets" class="stack"></section>
    </section>
  </main>

  <script>
    const state = { targets: [] };
    const targetsEl = document.querySelector("#targets");
    const targetSelect = document.querySelector("#message-target");
    const toast = document.querySelector("#toast");
    const botStatus = document.querySelector("#bot-status");

    document.querySelector("#refresh").addEventListener("click", load);
    document.querySelector("#target-form").addEventListener("submit", createTarget);
    document.querySelector("#message-form").addEventListener("submit", createMessage);

    setDefaultScheduleTime();
    load();
    checkBot();

    async function checkBot() {
      try {
        const data = await request("/api/bot");
        botStatus.textContent = data.bot?.username ? "Bot: @" + data.bot.username : "Bot: ready";
      } catch (error) {
        botStatus.textContent = "Bot: not ready";
      }
    }

    async function load() {
      const data = await request("/api/targets");
      state.targets = data.targets || [];
      render();
    }

    async function createTarget(event) {
      event.preventDefault();
      const form = event.currentTarget;
      const payload = Object.fromEntries(new FormData(form).entries());
      await request("/api/targets", { method: "POST", body: payload });
      form.reset();
      await load();
    }

    async function createMessage(event) {
      event.preventDefault();
      const form = event.currentTarget;
      const payload = Object.fromEntries(new FormData(form).entries());
      payload.targetId = Number(payload.targetId);
      await request("/api/messages", { method: "POST", body: payload });
      form.reset();
      setDefaultScheduleTime();
      await load();
    }

    async function deleteTarget(id) {
      await request("/api/targets/" + id, { method: "DELETE" });
      await load();
    }

    async function deleteMessage(id) {
      await request("/api/messages/" + id, { method: "DELETE" });
      await load();
    }

    async function postNow(id) {
      await request("/api/messages/" + id + "/post", { method: "POST" });
      await load();
    }

    function render() {
      targetSelect.innerHTML = state.targets.length
        ? state.targets.map((target) => '<option value="' + target.id + '">' + escapeHtml(target.title) + '</option>').join("")
        : '<option value="">Add a target first</option>';

      targetsEl.innerHTML = state.targets.length
        ? state.targets.map(renderTarget).join("")
        : '<div class="panel empty">No channels or groups yet.</div>';

      targetsEl.querySelectorAll("[data-delete-target]").forEach((button) => {
        button.addEventListener("click", () => deleteTarget(button.dataset.deleteTarget));
      });
      targetsEl.querySelectorAll("[data-delete-message]").forEach((button) => {
        button.addEventListener("click", () => deleteMessage(button.dataset.deleteMessage));
      });
      targetsEl.querySelectorAll("[data-post-now]").forEach((button) => {
        button.addEventListener("click", () => postNow(button.dataset.postNow));
      });
    }

    function renderTarget(target) {
      const messages = target.messages || [];
      return '<article class="target">' +
        '<div class="target-head">' +
          '<div class="stack">' +
            '<div class="target-title"><h2>' + escapeHtml(target.title) + '</h2><span class="badge">' + escapeHtml(target.type) + '</span></div>' +
            '<small>' + escapeHtml(target.chat_id) + '</small>' +
          '</div>' +
          '<div class="actions"><button class="danger" data-delete-target="' + target.id + '">Delete</button></div>' +
        '</div>' +
        '<div class="messages">' +
          (messages.length ? messages.map(renderMessage).join("") : '<div class="empty">No scheduled messages for this target.</div>') +
        '</div>' +
      '</article>';
    }

    function renderMessage(message) {
      return '<div class="message">' +
        '<div class="stack">' +
          '<div class="row"><h3>' + formatDate(message.scheduled_at) + '</h3><span class="badge status-' + message.status + '">' + message.status + '</span></div>' +
          '<div class="message-body">' + escapeHtml(message.body) + '</div>' +
          (message.error ? '<small class="status-failed">' + escapeHtml(message.error) + '</small>' : '') +
        '</div>' +
        '<div class="actions">' +
          '<button data-post-now="' + message.id + '"' + (message.status === "posted" ? " disabled" : "") + '>Post now</button>' +
          '<button class="danger" data-delete-message="' + message.id + '">Delete</button>' +
        '</div>' +
      '</div>';
    }

    async function request(path, options = {}) {
      toast.textContent = "";
      const response = await fetch(path, {
        method: options.method || "GET",
        headers: options.body ? { "content-type": "application/json" } : undefined,
        body: options.body ? JSON.stringify(options.body) : undefined
      });
      const data = await response.json();
      if (!response.ok) {
        toast.textContent = data.error || "Request failed";
        throw new Error(data.error || "Request failed");
      }
      return data;
    }

    function setDefaultScheduleTime() {
      const input = document.querySelector("#message-time");
      const date = new Date(Date.now() + 10 * 60 * 1000);
      input.value = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    }

    function formatDate(value) {
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short"
      }).format(new Date(value));
    }

    function escapeHtml(value) {
      return String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      }[char]));
    }
  </script>
</body>
</html>`;
