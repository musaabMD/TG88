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
        view_growth_week: percentageChange(latest?.view_count ?? null, previous?.view_count ?? null)
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
    : await env.DB.prepare(
        "SELECT * FROM messages WHERE target_id = ? AND status = 'draft' ORDER BY updated_at DESC LIMIT 1"
      ).bind(input.targetId).first<ScheduledMessage>();

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
      --warning: #a16207;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: var(--background); color: var(--foreground); }
    main { width: min(1380px, calc(100vw - 28px)); margin: 0 auto; padding: 22px 0; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-bottom: 18px; }
    h1, h2, h3, p { margin: 0; }
    h1 { font-size: 28px; font-weight: 650; letter-spacing: 0; }
    h2 { font-size: 16px; font-weight: 650; }
    h3 { font-size: 14px; font-weight: 650; }
    p, label, input, textarea, select, button { font-size: 14px; }
    small { color: var(--muted-foreground); }
    .muted { color: var(--muted-foreground); }
    .app { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 16px; align-items: start; }
    .content { display: grid; gap: 16px; }
    .panel, .message, .target-item { border: 1px solid var(--border); border-radius: 8px; background: var(--card); }
    .panel { padding: 16px; }
    .stack { display: grid; gap: 12px; }
    .field { display: grid; gap: 7px; }
    .row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .wrap { display: flex; flex-wrap: wrap; gap: 8px; }
    input, textarea, select {
      width: 100%; border: 1px solid var(--border); border-radius: 6px; background: #fff;
      padding: 10px 11px; color: var(--foreground); outline: none;
    }
    textarea { resize: vertical; line-height: 1.45; }
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
    .status-draft { color: var(--muted-foreground); }
    .status-posted, .positive { color: var(--success); }
    .status-failed, .negative { color: var(--danger); }
    .status-pending { color: var(--info); }
    .status-posting { color: var(--warning); }
    .sidebar { position: sticky; top: 14px; display: grid; gap: 12px; }
    .target-list { display: grid; gap: 8px; max-height: calc(100vh - 330px); overflow: auto; padding-right: 2px; }
    .target-item { display: grid; gap: 10px; padding: 12px; }
    .target-item.active { border-color: #18181b; box-shadow: inset 3px 0 0 #18181b; }
    .target-main { border: 0; padding: 0; text-align: left; background: transparent; display: grid; gap: 6px; }
    .target-meta, .stats { display: flex; gap: 6px; flex-wrap: wrap; }
    .composer textarea { min-height: 150px; border: 0; padding: 0; font-size: 20px; line-height: 1.35; }
    .composer textarea:focus { box-shadow: none; border-color: transparent; }
    .composer-tools { border-top: 1px solid var(--border); padding-top: 12px; display: grid; gap: 12px; }
    .composer-grid { display: grid; grid-template-columns: 1fr 220px; gap: 12px; }
    .metrics-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
    .metric { border: 1px solid var(--border); border-radius: 8px; padding: 12px; background: #fff; display: grid; gap: 4px; }
    .metric strong { font-size: 22px; font-weight: 650; }
    .segmented { display: flex; flex-wrap: wrap; gap: 6px; }
    .segmented button.active { background: var(--primary); color: var(--primary-foreground); border-color: var(--primary); }
    .message-list { display: grid; gap: 10px; }
    .message { padding: 14px; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; }
    .message-body { white-space: pre-wrap; line-height: 1.45; overflow-wrap: anywhere; }
    .actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
    .empty { padding: 28px; text-align: center; color: var(--muted-foreground); }
    .toast { min-height: 22px; color: var(--danger); }
    @media (max-width: 980px) {
      main { width: min(100vw - 24px, 760px); }
      header { align-items: flex-start; flex-direction: column; }
      .app, .composer-grid, .metrics-grid { grid-template-columns: 1fr; }
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
        <p class="muted">Telegram channel and group autoposter</p>
      </div>
      <div class="actions">
        <span id="bot-status" class="badge">Bot: checking</span>
        <button id="refresh">Refresh</button>
      </div>
    </header>

    <section class="app">
      <section class="content">
        <section class="panel composer stack">
          <div class="row">
            <select id="composer-target" aria-label="Channel or group"></select>
            <span id="draft-state" class="badge">Draft ready</span>
          </div>
          <textarea id="composer-body" placeholder="What is happening?"></textarea>
          <div class="composer-tools">
            <div class="composer-grid">
              <div class="field">
                <label for="schedule-time">Schedule time</label>
                <input id="schedule-time" type="datetime-local" />
              </div>
              <div class="field">
                <label>&nbsp;</label>
                <div class="actions">
                  <button id="schedule-draft" class="primary" type="button">Schedule</button>
                  <button id="publish-draft" type="button">Publish now</button>
                  <button id="clear-draft" class="ghost" type="button">Clear</button>
                </div>
              </div>
            </div>
            <div id="toast" class="toast" role="status"></div>
          </div>
        </section>

        <section class="panel stack">
          <div>
            <h2 id="selected-title">Select a channel or group</h2>
            <small id="selected-chat">Send /register@dn88appbot in a group or channel to make it appear here.</small>
          </div>
          <div id="metrics" class="metrics-grid"></div>
        </section>

        <section class="panel stack">
          <div class="row">
            <h2>Posts</h2>
            <div class="segmented" id="filters">
              <button type="button" data-filter="all" class="active">All</button>
              <button type="button" data-filter="draft">Draft</button>
              <button type="button" data-filter="scheduled">Scheduled</button>
              <button type="button" data-filter="published">Published</button>
            </div>
          </div>
          <div id="messages" class="message-list"></div>
        </section>
      </section>

      <aside class="sidebar">
        <section class="panel stack">
          <div class="row">
            <h2>Channels & groups</h2>
            <span id="target-count" class="badge">0</span>
          </div>
          <small>Use /register@dn88appbot in Telegram to add chats.</small>
          <div id="targets" class="target-list"></div>
        </section>

        <section id="rules-panel" class="panel stack"></section>
      </aside>
    </section>
  </main>

  <script>
    const state = {
      targets: [],
      selectedId: null,
      filter: 'all',
      currentDraftId: null,
      autosaveTimer: null,
      ruleTargetId: null
    };

    const targetsEl = document.querySelector('#targets');
    const messagesEl = document.querySelector('#messages');
    const toast = document.querySelector('#toast');
    const botStatus = document.querySelector('#bot-status');
    const composerTarget = document.querySelector('#composer-target');
    const composerBody = document.querySelector('#composer-body');
    const draftState = document.querySelector('#draft-state');

    document.querySelector('#refresh').addEventListener('click', load);
    document.querySelector('#schedule-draft').addEventListener('click', scheduleDraft);
    document.querySelector('#publish-draft').addEventListener('click', publishDraft);
    document.querySelector('#clear-draft').addEventListener('click', clearDraft);
    composerBody.addEventListener('input', queueDraftSave);
    composerTarget.addEventListener('change', () => {
      state.selectedId = Number(composerTarget.value) || null;
      selectTarget(state.selectedId);
    });
    document.querySelectorAll('#filters [data-filter]').forEach((button) => {
      button.addEventListener('click', () => {
        state.filter = button.dataset.filter;
        render();
      });
    });

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
      if (!state.ruleTargetId) state.ruleTargetId = state.selectedId;
      render();
      loadDraftForSelected();
    }

    function render() {
      const selected = getSelected();
      document.querySelector('#target-count').textContent = String(state.targets.length);
      renderTargetSelect();
      renderTargetList();
      renderSelected(selected);
      renderRules();
      renderMessages(selected);
      renderFilters();
    }

    function renderTargetSelect() {
      composerTarget.innerHTML = state.targets.length
        ? state.targets.map((target) => '<option value="' + target.id + '">' + escapeHtml(target.title) + '</option>').join('')
        : '<option value="">No channels or groups</option>';
      composerTarget.value = state.selectedId || '';
    }

    function renderTargetList() {
      targetsEl.innerHTML = state.targets.length
        ? state.targets.map((target) => {
            return '<article class="target-item ' + (target.id === state.selectedId ? 'active' : '') + '">' +
              '<button class="target-main" type="button" data-select-target="' + target.id + '">' +
                '<strong>' + escapeHtml(target.title) + '</strong>' +
                '<small>' + escapeHtml(target.chat_id) + '</small>' +
                '<span class="target-meta">' +
                  '<span class="badge">' + target.type + '</span>' +
                  '<span class="badge">' + formatNumber(target.member_count) + ' users</span>' +
                  '<span class="badge">' + (target.post_count || 0) + ' posts</span>' +
                '</span>' +
              '</button>' +
              '<div class="actions">' +
                '<button type="button" data-edit-rules="' + target.id + '">Rules</button>' +
              '</div>' +
            '</article>';
          }).join('')
        : '<div class="empty">No channels or groups yet.</div>';

      targetsEl.querySelectorAll('[data-select-target]').forEach((button) => {
        button.addEventListener('click', () => selectTarget(Number(button.dataset.selectTarget)));
      });
      targetsEl.querySelectorAll('[data-edit-rules]').forEach((button) => {
        button.addEventListener('click', () => {
          state.ruleTargetId = Number(button.dataset.editRules);
          state.selectedId = state.ruleTargetId;
          render();
          loadDraftForSelected();
        });
      });
    }

    function renderSelected(selected) {
      document.querySelector('#selected-title').textContent = selected ? selected.title : 'Select a channel or group';
      document.querySelector('#selected-chat').textContent = selected ? selected.chat_id : 'Send /register@dn88appbot in Telegram to add chats.';
      document.querySelector('#metrics').innerHTML = selected ? renderMetrics(selected) : '<div class="empty">No metrics yet.</div>';
      document.querySelector('#schedule-draft').disabled = !selected;
      document.querySelector('#publish-draft').disabled = !selected;
      composerBody.disabled = !selected;
    }

    function renderMetrics(target) {
      return [
        metricHtml('Posts', target.post_count || 0, 'total posts'),
        metricHtml('Users', formatNumber(target.member_count), growthText(target.member_growth_week, '5% weekly goal')),
        metricHtml('Views', target.view_count == null ? 'No data' : formatNumber(target.view_count), growthText(target.view_growth_week, '5% weekly goal')),
        metricHtml('Drafts', target.draft_count || 0, (target.published_count || 0) + ' published')
      ].join('');
    }

    function metricHtml(label, value, detail) {
      return '<div class="metric"><small>' + escapeHtml(label) + '</small><strong>' + escapeHtml(value) + '</strong><small>' + escapeHtml(detail) + '</small></div>';
    }

    function renderRules() {
      const target = state.targets.find((item) => item.id === state.ruleTargetId) || getSelected();
      const panel = document.querySelector('#rules-panel');
      if (!target) {
        panel.innerHTML = '<h2>Rules</h2><small>Select a channel or group.</small>';
        return;
      }
      panel.innerHTML = '<form id="rules-form" class="stack">' +
        '<div class="row"><h2>Rules</h2><span class="badge">' + escapeHtml(target.title) + '</span></div>' +
        '<textarea id="rules-text" placeholder="Posting rules, notes, tone, links to avoid">' + escapeHtml(target.rules || '') + '</textarea>' +
        '<button type="submit" class="primary">Save rules</button>' +
      '</form>';
      panel.querySelector('#rules-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const rules = panel.querySelector('#rules-text').value;
        await request('/api/targets/' + target.id, { method: 'PATCH', body: { rules } });
        await load();
      });
    }

    function renderMessages(selected) {
      const messages = selected ? filterMessages(selected.messages || []) : [];
      messagesEl.innerHTML = messages.length
        ? messages.map(renderMessage).join('')
        : '<div class="empty">No posts in this filter.</div>';

      messagesEl.querySelectorAll('[data-delete-message]').forEach((button) => {
        button.addEventListener('click', () => deleteMessage(button.dataset.deleteMessage));
      });
      messagesEl.querySelectorAll('[data-post-now]').forEach((button) => {
        button.addEventListener('click', () => postNow(button.dataset.postNow));
      });
    }

    function renderFilters() {
      document.querySelectorAll('#filters [data-filter]').forEach((button) => {
        button.classList.toggle('active', button.dataset.filter === state.filter);
      });
    }

    function renderMessage(message) {
      const statusLabel = message.status === 'posted' ? 'published' : message.status;
      const views = message.view_count == null ? 'views no data' : formatNumber(message.view_count) + ' views';
      return '<article class="message">' +
        '<div class="stack">' +
          '<div class="row"><h3>' + formatDate(message.scheduled_at) + '</h3><span class="badge status-' + message.status + '">' + statusLabel + '</span></div>' +
          '<div class="message-body">' + escapeHtml(message.body) + '</div>' +
          '<div class="stats"><span class="badge">' + views + '</span>' +
          (message.posted_at ? '<span class="badge status-posted">published ' + formatDate(message.posted_at) + '</span>' : '') +
          (message.error ? '<span class="badge status-failed">' + escapeHtml(message.error) + '</span>' : '') + '</div>' +
        '</div>' +
        '<div class="actions">' +
          '<button data-post-now="' + message.id + '"' + (message.status === 'posted' ? ' disabled' : '') + '>Publish</button>' +
          '<button class="danger" data-delete-message="' + message.id + '">Delete</button>' +
        '</div>' +
      '</article>';
    }

    function filterMessages(messages) {
      if (state.filter === 'draft') return messages.filter((message) => message.status === 'draft');
      if (state.filter === 'published') return messages.filter((message) => message.status === 'posted');
      if (state.filter === 'scheduled') return messages.filter((message) => message.status === 'pending' || message.status === 'posting');
      return messages;
    }

    async function queueDraftSave() {
      draftState.textContent = 'Draft unsaved';
      clearTimeout(state.autosaveTimer);
      state.autosaveTimer = setTimeout(saveCurrentDraft, 650);
    }

    async function saveCurrentDraft() {
      const selected = getSelected();
      if (!selected) return null;
      const body = composerBody.value.trim();
      if (!body) {
        draftState.textContent = 'Draft ready';
        return null;
      }
      draftState.textContent = 'Saving draft';
      const data = await request('/api/drafts', {
        method: 'PUT',
        body: { targetId: selected.id, body, draftId: state.currentDraftId }
      });
      state.currentDraftId = data.draft ? data.draft.id : null;
      draftState.textContent = 'Draft saved';
      return state.currentDraftId;
    }

    async function scheduleDraft() {
      const id = await saveCurrentDraft();
      const scheduledAt = document.querySelector('#schedule-time').value;
      if (!id) return showError('Write a post first');
      await request('/api/drafts/' + id + '/schedule', { method: 'POST', body: { scheduledAt } });
      composerBody.value = '';
      state.currentDraftId = null;
      draftState.textContent = 'Draft ready';
      setDefaultScheduleTime();
      await load();
    }

    async function publishDraft() {
      const id = await saveCurrentDraft();
      if (!id) return showError('Write a post first');
      await request('/api/drafts/' + id + '/publish', { method: 'POST' });
      composerBody.value = '';
      state.currentDraftId = null;
      draftState.textContent = 'Draft ready';
      await load();
    }

    async function clearDraft() {
      const selected = getSelected();
      composerBody.value = '';
      if (selected && state.currentDraftId) {
        await request('/api/drafts', { method: 'PUT', body: { targetId: selected.id, body: '', draftId: state.currentDraftId } });
      }
      state.currentDraftId = null;
      draftState.textContent = 'Draft ready';
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

    function selectTarget(id) {
      state.selectedId = id;
      if (!state.ruleTargetId) state.ruleTargetId = id;
      render();
      loadDraftForSelected();
    }

    function loadDraftForSelected() {
      const selected = getSelected();
      if (!selected) {
        composerBody.value = '';
        state.currentDraftId = null;
        return;
      }
      const draft = (selected.messages || []).find((message) => message.status === 'draft');
      state.currentDraftId = draft ? draft.id : null;
      composerBody.value = draft ? draft.body : '';
      draftState.textContent = draft ? 'Draft saved' : 'Draft ready';
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

    function showError(message) {
      toast.textContent = message;
    }

    function setDefaultScheduleTime() {
      const input = document.querySelector('#schedule-time');
      const date = new Date(Date.now() + 10 * 60 * 1000);
      input.value = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    }

    function formatDate(value) {
      return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
    }

    function formatNumber(value) {
      if (value === null || value === undefined) return 'No data';
      return new Intl.NumberFormat().format(value);
    }

    function growthText(value, suffix) {
      if (value === null || value === undefined) return 'Weekly growth no data';
      const sign = value > 0 ? '+' : '';
      return sign + value + '% weekly / ' + suffix;
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
