interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
}

type Target = {
  id: number;
  title: string;
  chat_id: string;
  type: "channel" | "group";
  enabled: number;
  rules: string;
  source: "manual" | "telegram";
  last_seen_at: string | null;
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
  view_count: number | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  target_title?: string;
  chat_id?: string;
};

type TelegramChat = {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
};

type TelegramMessage = {
  message_id: number;
  text?: string;
  chat: TelegramChat;
};

type TelegramUpdate = {
  message?: TelegramMessage;
  channel_post?: TelegramMessage;
  my_chat_member?: { chat: TelegramChat };
};

type TelegramResponse<T = unknown> = {
  ok: boolean;
  result?: T;
  description?: string;
};

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/") return htmlResponse(APP_HTML);
    if (url.pathname === "/api/health") return json({ ok: true });
    if (url.pathname === "/api/bot" && request.method === "GET") return getBot(env);
    if (url.pathname === "/telegram/webhook" && request.method === "POST") return telegramWebhook(request, env);

    if (url.pathname === "/api/targets" && request.method === "GET") return listTargets(env);
    if (url.pathname === "/api/targets" && request.method === "POST") return createTarget(request, env);

    const targetMatch = url.pathname.match(/^\/api\/targets\/(\d+)$/);
    if (targetMatch && request.method === "PATCH") return updateTarget(Number(targetMatch[1]), request, env);
    if (targetMatch && request.method === "DELETE") return deleteTarget(Number(targetMatch[1]), env);

    if (url.pathname === "/api/messages" && request.method === "GET") {
      const targetId = url.searchParams.get("targetId");
      return listMessages(env, targetId ? Number(targetId) : undefined);
    }
    if (url.pathname === "/api/messages" && request.method === "POST") return createMessage(request, env);
    if (url.pathname === "/api/messages/bulk" && request.method === "POST") return createBulkMessages(request, env);

    const messagePostMatch = url.pathname.match(/^\/api\/messages\/(\d+)\/post$/);
    if (messagePostMatch && request.method === "POST") return postOneMessage(Number(messagePostMatch[1]), env);

    const messageMatch = url.pathname.match(/^\/api\/messages\/(\d+)$/);
    if (messageMatch && request.method === "DELETE") return deleteMessage(Number(messageMatch[1]), env);

    return json({ error: "Not found" }, 404);
  },

  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await postDueMessages(env);
  }
};

async function getBot(env: Env): Promise<Response> {
  const result = await telegramRequest(env, "getMe", {});
  if (!result.ok) return json({ ok: false, error: result.description ?? "Telegram bot check failed" }, 502);
  return json({ ok: true, bot: result.result });
}

async function telegramWebhook(request: Request, env: Env): Promise<Response> {
  if (env.TELEGRAM_WEBHOOK_SECRET) {
    const received = request.headers.get("x-telegram-bot-api-secret-token");
    if (received !== env.TELEGRAM_WEBHOOK_SECRET) return json({ ok: false }, 403);
  }

  const update = await readJson<TelegramUpdate>(request);
  const chat = update.message?.chat ?? update.channel_post?.chat ?? update.my_chat_member?.chat;
  if (!chat || chat.type === "private") return json({ ok: true });

  const target = await upsertTargetFromChat(chat, env);
  const text = update.message?.text ?? "";
  if (text.startsWith("/register")) {
    await telegramRequest(env, "sendMessage", {
      chat_id: String(chat.id),
      text: `Registered ${target.title} in TG88.`
    });
  }

  return json({ ok: true });
}

async function upsertTargetFromChat(chat: TelegramChat, env: Env): Promise<Target> {
  const now = new Date().toISOString();
  const chatId = String(chat.id);
  const title = chat.title ?? chat.username ?? [chat.first_name, chat.last_name].filter(Boolean).join(" ") ?? chatId;
  const type = chat.type === "channel" ? "channel" : "group";

  await env.DB.prepare(
    `INSERT INTO targets (title, chat_id, type, source, last_seen_at)
     VALUES (?, ?, ?, 'telegram', ?)
     ON CONFLICT(chat_id) DO UPDATE SET
       title = excluded.title,
       type = excluded.type,
       source = 'telegram',
       last_seen_at = excluded.last_seen_at`
  ).bind(title, chatId, type, now).run();

  const target = await env.DB.prepare("SELECT * FROM targets WHERE chat_id = ?").bind(chatId).first<Target>();
  if (!target) throw new Error("Target registration failed");
  return target;
}

async function listTargets(env: Env): Promise<Response> {
  const targets = await env.DB.prepare(
    `SELECT id, title, chat_id, type, enabled, rules, source, last_seen_at, created_at
     FROM targets
     ORDER BY COALESCE(last_seen_at, created_at) DESC`
  ).all<Target>();

  const messages = await env.DB.prepare(
    `SELECT messages.*, targets.title AS target_title, targets.chat_id
     FROM messages
     JOIN targets ON targets.id = messages.target_id
     ORDER BY messages.scheduled_at DESC
     LIMIT 300`
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

  if (!title || !chatId) return json({ error: "Title and chat ID are required" }, 400);

  await env.DB.prepare(
    `INSERT INTO targets (title, chat_id, type)
     VALUES (?, ?, ?)
     ON CONFLICT(chat_id) DO UPDATE SET title = excluded.title, type = excluded.type`
  ).bind(title, chatId, type).run();

  return listTargets(env);
}

async function updateTarget(id: number, request: Request, env: Env): Promise<Response> {
  const input = await readJson<{ rules?: string; title?: string }>(request);
  const rules = cleanText(input.rules ?? "", 8000);
  const title = cleanText(input.title ?? "", 80);

  if (title) {
    await env.DB.prepare("UPDATE targets SET title = ?, rules = ? WHERE id = ?").bind(title, rules, id).run();
  } else {
    await env.DB.prepare("UPDATE targets SET rules = ? WHERE id = ?").bind(rules, id).run();
  }

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
         LIMIT 300`
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

  if (!(await targetExists(env, input.targetId))) return json({ error: "Target not found" }, 404);

  await insertMessage(env, input.targetId, body, scheduledAt);
  return listTargets(env);
}

async function createBulkMessages(request: Request, env: Env): Promise<Response> {
  const input = await readJson<{
    targetId?: number;
    bodies?: string[];
    firstScheduledAt?: string;
    spacingMinutes?: number;
  }>(request);
  const firstScheduledAt = normalizeDate(input.firstScheduledAt);
  const spacingMinutes = Math.max(0, Math.min(1440, Number(input.spacingMinutes ?? 5)));
  const bodies = (input.bodies ?? []).map((body) => cleanText(body, 4096)).filter(Boolean).slice(0, 100);

  if (!input.targetId || !firstScheduledAt || bodies.length === 0) {
    return json({ error: "Target, first schedule time, and at least one message are required" }, 400);
  }

  if (!(await targetExists(env, input.targetId))) return json({ error: "Target not found" }, 404);

  const start = new Date(firstScheduledAt).getTime();
  const batchId = crypto.randomUUID();
  for (let index = 0; index < bodies.length; index += 1) {
    const scheduledAt = new Date(start + index * spacingMinutes * 60_000).toISOString();
    await insertMessage(env, input.targetId, bodies[index], scheduledAt, batchId);
  }

  return listTargets(env);
}

async function insertMessage(
  env: Env,
  targetId: number,
  body: string,
  scheduledAt: string,
  batchId: string | null = null
): Promise<void> {
  await env.DB.prepare("INSERT INTO messages (target_id, body, scheduled_at, batch_id) VALUES (?, ?, ?, ?)")
    .bind(targetId, body, scheduledAt, batchId)
    .run();
}

async function targetExists(env: Env, targetId: number): Promise<boolean> {
  const target = await env.DB.prepare("SELECT id FROM targets WHERE id = ? AND enabled = 1")
    .bind(targetId)
    .first<{ id: number }>();
  return Boolean(target);
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

  if (!message) return json({ error: "Message not found" }, 404);
  if (message.status === "posted") return json({ error: "Message already posted" }, 409);

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

  for (const message of due.results ?? []) await sendAndRecord(message, env);
}

async function sendAndRecord(message: ScheduledMessage, env: Env): Promise<void> {
  const claimed = await env.DB.prepare(
    `UPDATE messages
     SET status = 'posting', attempts = attempts + 1, updated_at = ?
     WHERE id = ? AND status IN ('pending', 'failed')`
  ).bind(new Date().toISOString(), message.id).run();

  if (claimed.meta.changes === 0) return;

  const sent = await telegramRequest<{ message_id: number; views?: number }>(env, "sendMessage", {
    chat_id: message.chat_id,
    text: message.body,
    disable_web_page_preview: false
  });

  const now = new Date().toISOString();
  if (sent.ok && sent.result?.message_id) {
    await env.DB.prepare(
      `UPDATE messages
       SET status = 'posted', posted_at = ?, telegram_message_id = ?, view_count = ?, error = NULL, updated_at = ?
       WHERE id = ?`
    ).bind(now, sent.result.message_id, sent.result.views ?? null, now, message.id).run();
    return;
  }

  await env.DB.prepare(
    `UPDATE messages
     SET status = 'failed', error = ?, updated_at = ?
     WHERE id = ?`
  ).bind(sent.description ?? "Telegram send failed", now, message.id).run();
}

async function telegramRequest<T>(env: Env, method: string, payload: unknown): Promise<TelegramResponse<T>> {
  if (!env.TELEGRAM_BOT_TOKEN) return { ok: false, description: "TELEGRAM_BOT_TOKEN is not configured" };

  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  return response.json<TelegramResponse<T>>();
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
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
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
      --foreground: #18181b;
      --card: #ffffff;
      --muted: #f4f4f5;
      --muted-foreground: #71717a;
      --border: #e4e4e7;
      --primary: #18181b;
      --primary-foreground: #ffffff;
      --danger: #b91c1c;
      --success: #15803d;
      --info: #0369a1;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: var(--background); color: var(--foreground); }
    main { width: min(1360px, calc(100vw - 28px)); margin: 0 auto; padding: 22px 0; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-bottom: 18px; }
    h1, h2, h3, p { margin: 0; }
    h1 { font-size: 28px; font-weight: 650; letter-spacing: 0; }
    h2 { font-size: 16px; font-weight: 650; }
    h3 { font-size: 14px; font-weight: 650; }
    p, label, input, textarea, select, button { font-size: 14px; }
    small { color: var(--muted-foreground); }
    .muted { color: var(--muted-foreground); }
    .app { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 16px; align-items: start; }
    .content { display: grid; gap: 16px; }
    .panel, .message, .target-button { border: 1px solid var(--border); border-radius: 8px; background: var(--card); }
    .panel { padding: 16px; }
    .stack { display: grid; gap: 12px; }
    .field { display: grid; gap: 7px; }
    .grid-2 { display: grid; grid-template-columns: 1fr 180px; gap: 12px; }
    .row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    input, textarea, select {
      width: 100%; border: 1px solid var(--border); border-radius: 6px; background: #fff;
      padding: 10px 11px; color: var(--foreground); outline: none;
    }
    textarea { min-height: 118px; resize: vertical; line-height: 1.45; }
    input:focus, textarea:focus, select:focus { border-color: #a1a1aa; box-shadow: 0 0 0 3px rgba(24,24,27,.08); }
    button {
      border: 1px solid var(--border); border-radius: 6px; background: #fff; color: var(--foreground);
      padding: 9px 12px; font-weight: 550; cursor: pointer;
    }
    button.primary { background: var(--primary); border-color: var(--primary); color: var(--primary-foreground); }
    button.danger { color: var(--danger); }
    button.ghost { border-color: transparent; background: transparent; }
    button:disabled { cursor: not-allowed; opacity: .55; }
    .badge {
      display: inline-flex; align-items: center; min-height: 22px; border: 1px solid var(--border);
      border-radius: 999px; padding: 2px 8px; color: var(--muted-foreground); background: var(--muted);
      font-size: 12px; line-height: 1;
    }
    .status-posted { color: var(--success); }
    .status-failed { color: var(--danger); }
    .status-pending { color: var(--info); }
    .status-posting { color: #a16207; }
    .sidebar { position: sticky; top: 14px; display: grid; gap: 12px; }
    .target-list { display: grid; gap: 8px; max-height: calc(100vh - 190px); overflow: auto; padding-right: 2px; }
    .target-button {
      display: grid; gap: 6px; width: 100%; text-align: left; padding: 12px; background: #fff;
    }
    .target-button.active { border-color: #18181b; box-shadow: inset 3px 0 0 #18181b; }
    .target-meta { display: flex; gap: 6px; flex-wrap: wrap; }
    .composer { display: grid; grid-template-columns: 1fr 300px; gap: 14px; align-items: start; }
    .message-list { display: grid; gap: 10px; }
    .message { padding: 14px; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; }
    .message-body { white-space: pre-wrap; line-height: 1.45; overflow-wrap: anywhere; }
    .stats { display: flex; flex-wrap: wrap; gap: 8px; }
    .actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
    .empty { padding: 28px; text-align: center; color: var(--muted-foreground); }
    .toast { min-height: 22px; color: var(--danger); }
    @media (max-width: 980px) {
      main { width: min(100vw - 24px, 760px); }
      header { align-items: flex-start; flex-direction: column; }
      .app, .composer, .grid-2 { grid-template-columns: 1fr; }
      .sidebar { position: static; order: -1; }
      .target-list { max-height: none; }
      .message { grid-template-columns: 1fr; }
      .actions { justify-content: flex-start; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>TG88</h1>
        <p class="muted" id="subtitle">Telegram channel and group autoposter</p>
      </div>
      <div class="actions">
        <span id="bot-status" class="badge">Bot: checking</span>
        <button id="refresh">Refresh</button>
      </div>
    </header>

    <section class="app">
      <section class="content">
        <section class="panel stack">
          <div class="row">
            <div>
              <h2 id="selected-title">Select a channel or group</h2>
              <small id="selected-chat">Add the bot, register the chat, then schedule posts.</small>
            </div>
            <span id="selected-type" class="badge">No target</span>
          </div>

          <form id="rules-form" class="stack">
            <div class="field">
              <label for="rules">Rules file</label>
              <textarea id="rules" name="rules" placeholder="Posting rules, notes, content style, links to avoid"></textarea>
            </div>
            <button type="submit">Save rules</button>
          </form>
        </section>

        <section class="panel stack">
          <div>
            <h2>Fast scheduler</h2>
            <small>Write many posts quickly. Separate posts with a blank line or ---.</small>
          </div>
          <form id="bulk-form" class="stack">
            <div class="field">
              <label for="bulk-body">Posts</label>
              <textarea id="bulk-body" name="body" placeholder="First post&#10;&#10;Second post&#10;&#10;---&#10;Third post"></textarea>
            </div>
            <div class="grid-2">
              <div class="field">
                <label for="bulk-time">First post time</label>
                <input id="bulk-time" name="firstScheduledAt" type="datetime-local" required />
              </div>
              <div class="field">
                <label for="bulk-spacing">Minutes between</label>
                <input id="bulk-spacing" name="spacingMinutes" type="number" min="0" max="1440" value="5" />
              </div>
            </div>
            <button class="primary" type="submit">Schedule posts</button>
          </form>
          <div id="toast" class="toast" role="status"></div>
        </section>

        <section class="panel stack">
          <div class="row">
            <h2>Scheduled posts</h2>
            <div class="stats" id="stats"></div>
          </div>
          <div id="messages" class="message-list"></div>
        </section>
      </section>

      <aside class="sidebar">
        <form id="target-form" class="panel stack">
          <h2>Add manually</h2>
          <div class="field">
            <label for="target-title">Name</label>
            <input id="target-title" name="title" placeholder="Announcements" required />
          </div>
          <div class="field">
            <label for="target-chat">Chat ID</label>
            <input id="target-chat" name="chatId" placeholder="@channel or -100..." required />
          </div>
          <div class="field">
            <label for="target-type">Type</label>
            <select id="target-type" name="type">
              <option value="channel">Channel</option>
              <option value="group">Group</option>
            </select>
          </div>
          <button class="primary" type="submit">Add</button>
        </form>

        <section class="panel stack">
          <div class="row">
            <h2>Channels & groups</h2>
            <span id="target-count" class="badge">0</span>
          </div>
          <div id="targets" class="target-list"></div>
        </section>
      </aside>
    </section>
  </main>

  <script>
    const state = { targets: [], selectedId: null };
    const targetsEl = document.querySelector('#targets');
    const messagesEl = document.querySelector('#messages');
    const toast = document.querySelector('#toast');
    const botStatus = document.querySelector('#bot-status');
    const rulesInput = document.querySelector('#rules');

    document.querySelector('#refresh').addEventListener('click', load);
    document.querySelector('#target-form').addEventListener('submit', createTarget);
    document.querySelector('#bulk-form').addEventListener('submit', createBulkMessages);
    document.querySelector('#rules-form').addEventListener('submit', saveRules);

    setDefaultScheduleTime();
    load();
    checkBot();

    async function checkBot() {
      try {
        const data = await request('/api/bot');
        botStatus.textContent = data.bot && data.bot.username ? 'Bot: @' + data.bot.username : 'Bot: ready';
      } catch (error) {
        botStatus.textContent = 'Bot: not ready';
      }
    }

    async function load() {
      const data = await request('/api/targets');
      state.targets = data.targets || [];
      if (!state.selectedId && state.targets.length) state.selectedId = state.targets[0].id;
      if (state.selectedId && !state.targets.some((target) => target.id === state.selectedId)) {
        state.selectedId = state.targets[0] ? state.targets[0].id : null;
      }
      render();
    }

    async function createTarget(event) {
      event.preventDefault();
      const form = event.currentTarget;
      const payload = Object.fromEntries(new FormData(form).entries());
      const data = await request('/api/targets', { method: 'POST', body: payload });
      form.reset();
      state.targets = data.targets || [];
      const created = state.targets.find((target) => target.chat_id === payload.chatId);
      if (created) state.selectedId = created.id;
      render();
    }

    async function createBulkMessages(event) {
      event.preventDefault();
      const selected = getSelected();
      if (!selected) return showError('Choose a channel or group first');
      const form = event.currentTarget;
      const values = Object.fromEntries(new FormData(form).entries());
      const bodies = splitPosts(values.body);
      if (!bodies.length) return showError('Write at least one post');
      await request('/api/messages/bulk', {
        method: 'POST',
        body: {
          targetId: selected.id,
          bodies,
          firstScheduledAt: values.firstScheduledAt,
          spacingMinutes: Number(values.spacingMinutes || 0)
        }
      });
      document.querySelector('#bulk-body').value = '';
      setDefaultScheduleTime();
      await load();
    }

    async function saveRules(event) {
      event.preventDefault();
      const selected = getSelected();
      if (!selected) return showError('Choose a channel or group first');
      await request('/api/targets/' + selected.id, { method: 'PATCH', body: { rules: rulesInput.value } });
      await load();
    }

    async function deleteTarget(id) {
      await request('/api/targets/' + id, { method: 'DELETE' });
      if (state.selectedId === Number(id)) state.selectedId = null;
      await load();
    }

    async function deleteMessage(id) {
      await request('/api/messages/' + id, { method: 'DELETE' });
      await load();
    }

    async function postNow(id) {
      await request('/api/messages/' + id + '/post', { method: 'POST' });
      await load();
    }

    function render() {
      const selected = getSelected();
      document.querySelector('#target-count').textContent = String(state.targets.length);
      renderTargetList();
      renderSelected(selected);
      renderMessages(selected);
    }

    function renderTargetList() {
      targetsEl.innerHTML = state.targets.length
        ? state.targets.map((target) => {
            const messages = target.messages || [];
            const pending = messages.filter((message) => message.status === 'pending').length;
            const posted = messages.filter((message) => message.status === 'posted').length;
            return '<button class="target-button ' + (target.id === state.selectedId ? 'active' : '') + '" data-select-target="' + target.id + '">' +
              '<strong>' + escapeHtml(target.title) + '</strong>' +
              '<small>' + escapeHtml(target.chat_id) + '</small>' +
              '<span class="target-meta"><span class="badge">' + target.type + '</span><span class="badge">' + pending + ' pending</span><span class="badge">' + posted + ' posted</span></span>' +
            '</button>';
          }).join('')
        : '<div class="empty">No channels or groups yet.</div>';

      targetsEl.querySelectorAll('[data-select-target]').forEach((button) => {
        button.addEventListener('click', () => {
          state.selectedId = Number(button.dataset.selectTarget);
          render();
        });
      });
    }

    function renderSelected(selected) {
      document.querySelector('#selected-title').textContent = selected ? selected.title : 'Select a channel or group';
      document.querySelector('#selected-chat').textContent = selected ? selected.chat_id : 'Add the bot, register the chat, then schedule posts.';
      document.querySelector('#selected-type').textContent = selected ? selected.type : 'No target';
      rulesInput.value = selected ? selected.rules || '' : '';
      document.querySelector('#rules-form button').disabled = !selected;
      document.querySelector('#bulk-form button').disabled = !selected;
    }

    function renderMessages(selected) {
      const messages = selected ? selected.messages || [] : [];
      const counts = {
        pending: messages.filter((message) => message.status === 'pending').length,
        posted: messages.filter((message) => message.status === 'posted').length,
        failed: messages.filter((message) => message.status === 'failed').length
      };
      document.querySelector('#stats').innerHTML =
        '<span class="badge status-pending">' + counts.pending + ' pending</span>' +
        '<span class="badge status-posted">' + counts.posted + ' posted</span>' +
        '<span class="badge status-failed">' + counts.failed + ' failed</span>';

      messagesEl.innerHTML = messages.length
        ? messages.map(renderMessage).join('')
        : '<div class="empty">No scheduled posts for this target.</div>';

      messagesEl.querySelectorAll('[data-delete-message]').forEach((button) => {
        button.addEventListener('click', () => deleteMessage(button.dataset.deleteMessage));
      });
      messagesEl.querySelectorAll('[data-post-now]').forEach((button) => {
        button.addEventListener('click', () => postNow(button.dataset.postNow));
      });
      messagesEl.querySelectorAll('[data-delete-target]').forEach((button) => {
        button.addEventListener('click', () => deleteTarget(button.dataset.deleteTarget));
      });
    }

    function renderMessage(message) {
      const views = message.view_count == null ? 'views not available' : message.view_count + ' views';
      return '<article class="message">' +
        '<div class="stack">' +
          '<div class="row"><h3>' + formatDate(message.scheduled_at) + '</h3><span class="badge status-' + message.status + '">' + message.status + '</span></div>' +
          '<div class="message-body">' + escapeHtml(message.body) + '</div>' +
          '<div class="stats"><span class="badge">' + views + '</span>' +
          (message.posted_at ? '<span class="badge status-posted">posted ' + formatDate(message.posted_at) + '</span>' : '') +
          (message.error ? '<span class="badge status-failed">' + escapeHtml(message.error) + '</span>' : '') + '</div>' +
        '</div>' +
        '<div class="actions">' +
          '<button data-post-now="' + message.id + '"' + (message.status === 'posted' ? ' disabled' : '') + '>Post now</button>' +
          '<button class="danger" data-delete-message="' + message.id + '">Delete</button>' +
        '</div>' +
      '</article>';
    }

    async function request(path, options = {}) {
      toast.textContent = '';
      const response = await fetch(path, {
        method: options.method || 'GET',
        headers: options.body ? { 'content-type': 'application/json' } : undefined,
        body: options.body ? JSON.stringify(options.body) : undefined
      });
      const data = await response.json();
      if (!response.ok) {
        showError(data.error || 'Request failed');
        throw new Error(data.error || 'Request failed');
      }
      return data;
    }

    function getSelected() {
      return state.targets.find((target) => target.id === state.selectedId) || null;
    }

    function splitPosts(value) {
      return String(value || '')
        .split(/\\n\\s*(?:---+)?\\s*\\n/g)
        .map((part) => part.trim())
        .filter(Boolean);
    }

    function showError(message) {
      toast.textContent = message;
    }

    function setDefaultScheduleTime() {
      const input = document.querySelector('#bulk-time');
      const date = new Date(Date.now() + 10 * 60 * 1000);
      input.value = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    }

    function formatDate(value) {
      return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
    }

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
      }[char]));
    }
  </script>
</body>
</html>`;
