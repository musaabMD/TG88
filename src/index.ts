import { UI_BUNDLE } from "./generated/ui-bundle";

interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
}

type MessageStatus = "draft" | "pending" | "posting" | "posted" | "failed";

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
  post_count?: number;
  draft_count?: number;
  scheduled_count?: number;
  published_count?: number;
  failed_count?: number;
  member_count?: number | null;
  member_growth_week?: number | null;
  view_count?: number | null;
  view_growth_week?: number | null;
  member_history?: number[];
  view_history?: number[];
  metrics_error?: string | null;
};

type ScheduledMessage = {
  id: number;
  target_id: number;
  body: string;
  scheduled_at: string;
  status: MessageStatus;
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

type TargetMetric = {
  target_id: number;
  member_count: number | null;
  view_count: number | null;
  captured_at: string;
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
    if (url.pathname === "/app.js") return javascriptResponse(UI_BUNDLE);
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
    if (url.pathname === "/api/drafts" && request.method === "PUT") return saveDraft(request, env);

    const draftScheduleMatch = url.pathname.match(/^\/api\/drafts\/(\d+)\/schedule$/);
    if (draftScheduleMatch && request.method === "POST") return scheduleDraft(Number(draftScheduleMatch[1]), request, env);

    const draftPublishMatch = url.pathname.match(/^\/api\/drafts\/(\d+)\/publish$/);
    if (draftPublishMatch && request.method === "POST") return publishDraft(Number(draftPublishMatch[1]), env);

    const messagePostMatch = url.pathname.match(/^\/api\/messages\/(\d+)\/post$/);
    if (messagePostMatch && request.method === "POST") return postOneMessage(Number(messagePostMatch[1]), env);

    const messageMatch = url.pathname.match(/^\/api\/messages\/(\d+)$/);
    if (messageMatch && request.method === "DELETE") return deleteMessage(Number(messageMatch[1]), env);

    return json({ error: "Not found" }, 404);
  },

  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await postDueMessages(env);
    await syncTargetMetrics(env);
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
  await syncTargetMetrics(env);

  const targets = await env.DB.prepare(
    `SELECT id, title, chat_id, type, enabled, rules, source, last_seen_at, created_at
     FROM targets
     ORDER BY COALESCE(last_seen_at, created_at) DESC`
  ).all<Target>();

  const messages = await env.DB.prepare(
    `SELECT messages.*, targets.title AS target_title, targets.chat_id
     FROM messages
     JOIN targets ON targets.id = messages.target_id
     ORDER BY messages.updated_at DESC
     LIMIT 500`
  ).all<ScheduledMessage>();

  const metrics = await env.DB.prepare(
    "SELECT target_id, member_count, view_count, captured_at FROM target_metrics ORDER BY captured_at DESC"
  ).all<TargetMetric>();

  const messagesByTarget = new Map<number, ScheduledMessage[]>();
  for (const message of messages.results ?? []) {
    const list = messagesByTarget.get(message.target_id) ?? [];
    list.push(message);
    messagesByTarget.set(message.target_id, list);
  }

  const metricsByTarget = new Map<number, TargetMetric[]>();
  for (const metric of metrics.results ?? []) {
    const list = metricsByTarget.get(metric.target_id) ?? [];
    list.push(metric);
    metricsByTarget.set(metric.target_id, list);
  }

  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  return json({
    targets: (targets.results ?? []).map((target) => {
      const targetMessages = messagesByTarget.get(target.id) ?? [];
      const targetMetrics = metricsByTarget.get(target.id) ?? [];
      const latest = targetMetrics[0];
      const previous = targetMetrics.find((metric) => new Date(metric.captured_at).getTime() <= weekAgo);
      const memberHistory = buildHistory(targetMetrics, "member_count");
      const viewHistory = buildHistory(targetMetrics, "view_count");

      return {
        ...target,
        messages: targetMessages,
        post_count: targetMessages.filter((message) => message.status !== "draft").length,
        draft_count: targetMessages.filter((message) => message.status === "draft").length,
        scheduled_count: targetMessages.filter((message) => message.status === "pending" || message.status === "posting").length,
        published_count: targetMessages.filter((message) => message.status === "posted").length,
        failed_count: targetMessages.filter((message) => message.status === "failed").length,
        member_count: latest?.member_count ?? null,
        member_growth_week: percentageChange(latest?.member_count ?? null, previous?.member_count ?? null),
        view_count: latest?.view_count ?? null,
        view_growth_week: percentageChange(latest?.view_count ?? null, previous?.view_count ?? null),
        member_history: memberHistory,
        view_history: viewHistory
      };
    })
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
         ORDER BY messages.updated_at DESC`
      ).bind(targetId)
    : env.DB.prepare(
        `SELECT messages.*, targets.title AS target_title, targets.chat_id
         FROM messages
         JOIN targets ON targets.id = messages.target_id
         ORDER BY messages.updated_at DESC
         LIMIT 500`
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

  await insertMessage(env, input.targetId, body, scheduledAt, "pending");
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
    await insertMessage(env, input.targetId, bodies[index], scheduledAt, "pending", batchId);
  }

  return listTargets(env);
}

async function saveDraft(request: Request, env: Env): Promise<Response> {
  const input = await readJson<{ targetId?: number; body?: string; draftId?: number }>(request);
  const body = cleanText(input.body, 4096);
  const now = new Date().toISOString();

  if (!input.targetId) return json({ error: "Target is required" }, 400);
  if (!(await targetExists(env, input.targetId))) return json({ error: "Target not found" }, 404);

  if (!body) {
    if (input.draftId) await env.DB.prepare("DELETE FROM messages WHERE id = ? AND status = 'draft'").bind(input.draftId).run();
    return json({ draft: null });
  }

  const existing = input.draftId
    ? await env.DB.prepare("SELECT * FROM messages WHERE id = ? AND target_id = ? AND status = 'draft'")
        .bind(input.draftId, input.targetId)
        .first<ScheduledMessage>()
    : null;

  if (existing) {
    await env.DB.prepare("UPDATE messages SET body = ?, scheduled_at = ?, updated_at = ? WHERE id = ?")
      .bind(body, now, now, existing.id)
      .run();
    const draft = await env.DB.prepare("SELECT * FROM messages WHERE id = ?").bind(existing.id).first<ScheduledMessage>();
    return json({ draft });
  }

  await insertMessage(env, input.targetId, body, now, "draft");
  const draft = await env.DB.prepare(
    "SELECT * FROM messages WHERE target_id = ? AND status = 'draft' ORDER BY id DESC LIMIT 1"
  ).bind(input.targetId).first<ScheduledMessage>();
  return json({ draft });
}

async function scheduleDraft(id: number, request: Request, env: Env): Promise<Response> {
  const input = await readJson<{ scheduledAt?: string }>(request);
  const scheduledAt = normalizeDate(input.scheduledAt);
  if (!scheduledAt) return json({ error: "Schedule time is required" }, 400);

  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    "UPDATE messages SET status = 'pending', scheduled_at = ?, updated_at = ? WHERE id = ? AND status = 'draft'"
  ).bind(scheduledAt, now, id).run();

  if (result.meta.changes === 0) return json({ error: "Draft not found" }, 404);
  return listTargets(env);
}

async function publishDraft(id: number, env: Env): Promise<Response> {
  return postOneMessage(id, env);
}

async function insertMessage(
  env: Env,
  targetId: number,
  body: string,
  scheduledAt: string,
  status: MessageStatus,
  batchId: string | null = null
): Promise<void> {
  await env.DB.prepare("INSERT INTO messages (target_id, body, scheduled_at, status, batch_id) VALUES (?, ?, ?, ?, ?)")
    .bind(targetId, body, scheduledAt, status, batchId)
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
  if (message.status === "posted") return json({ error: "Message already published" }, 409);

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
     WHERE id = ? AND status IN ('draft', 'pending', 'failed')`
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
       SET status = 'posted', posted_at = ?, scheduled_at = ?, telegram_message_id = ?, view_count = ?, error = NULL, updated_at = ?
       WHERE id = ?`
    ).bind(now, now, sent.result.message_id, sent.result.views ?? null, now, message.id).run();
    await syncOneTargetMetrics(env, message.target_id, message.chat_id ?? "");
    return;
  }

  await env.DB.prepare(
    `UPDATE messages
     SET status = 'failed', error = ?, updated_at = ?
     WHERE id = ?`
  ).bind(sent.description ?? "Telegram send failed", now, message.id).run();
}

async function syncTargetMetrics(env: Env): Promise<void> {
  const targets = await env.DB.prepare(
    "SELECT id, chat_id FROM targets WHERE enabled = 1 ORDER BY COALESCE(last_seen_at, created_at) DESC LIMIT 50"
  ).all<{ id: number; chat_id: string }>();

  for (const target of targets.results ?? []) {
    await syncOneTargetMetrics(env, target.id, target.chat_id);
  }
}

async function syncOneTargetMetrics(env: Env, targetId: number, chatId: string): Promise<void> {
  const latest = await env.DB.prepare(
    "SELECT captured_at FROM target_metrics WHERE target_id = ? ORDER BY captured_at DESC LIMIT 1"
  ).bind(targetId).first<{ captured_at: string }>();

  if (latest && Date.now() - new Date(latest.captured_at).getTime() < 60 * 60 * 1000) return;

  const memberResult = await telegramRequest<number>(env, "getChatMemberCount", { chat_id: chatId });
  if (!memberResult.ok) return;

  const views = await env.DB.prepare(
    "SELECT COUNT(view_count) AS rows_with_views, SUM(view_count) AS total_views FROM messages WHERE target_id = ? AND status = 'posted'"
  ).bind(targetId).first<{ rows_with_views: number; total_views: number | null }>();

  const viewCount = views && views.rows_with_views > 0 ? views.total_views ?? 0 : null;

  await env.DB.prepare("INSERT INTO target_metrics (target_id, member_count, view_count, captured_at) VALUES (?, ?, ?, ?)")
    .bind(targetId, memberResult.result ?? null, viewCount, new Date().toISOString())
    .run();
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

function percentageChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function buildHistory(metrics: TargetMetric[], key: "member_count" | "view_count"): number[] {
  const oldestFirst = [...metrics]
    .reverse()
    .map((metric) => metric[key])
    .filter((value): value is number => typeof value === "number")
    .slice(-8);

  if (oldestFirst.length === 0) return Array(8).fill(0);
  while (oldestFirst.length < 8) oldestFirst.unshift(oldestFirst[0]);
  return oldestFirst;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function javascriptResponse(body: string): Response {
  return new Response(body, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "no-store"
    }
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
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-50">
  <div id="root"></div>
  <script src="/app.js"></script>
</body>
</html>`;
