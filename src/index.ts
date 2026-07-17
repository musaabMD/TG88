import { UI_BUNDLE } from "./generated/ui-bundle";

interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
}

type MessageStatus = "draft" | "pending" | "posting" | "posted" | "failed";

type Target = {
  id: number;
  title: string;
  chat_id: string;
  thread_id: number;
  topic_name: string | null;
  type: "channel" | "group";
  enabled: number;
  rules: string;
  moderation_enabled: number;
  moderation_rules: string;
  photo_file_id: string | null;
  photo_updated_at: string | null;
  source: "manual" | "telegram";
  last_seen_at: string | null;
  created_at: string;
  messages?: ScheduledMessage[];
  moderation_actions?: ModerationAction[];
  moderation_action_count?: number;
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
  kind: "text" | "poll";
  poll_options: string | null;
  link_preview_enabled: number;
  repeat_group_id: string | null;
  repeat_index: number;
  error: string | null;
  created_at: string;
  updated_at: string;
  target_title?: string;
  chat_id?: string;
  thread_id?: number;
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
  photo?: TelegramChatPhoto;
};

type TelegramChatPhoto = {
  small_file_id: string;
  small_file_unique_id: string;
  big_file_id: string;
  big_file_unique_id: string;
};

type TelegramFile = {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
};

type TelegramUser = {
  id: number;
  is_bot: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
};

type TelegramMessageEntity = {
  type: string;
  offset: number;
  length: number;
  url?: string;
};

type TelegramMessage = {
  message_id: number;
  text?: string;
  caption?: string;
  chat: TelegramChat;
  from?: TelegramUser;
  message_thread_id?: number;
  entities?: TelegramMessageEntity[];
  caption_entities?: TelegramMessageEntity[];
  photo?: unknown[];
  new_chat_members?: TelegramUser[];
  forum_topic_created?: { name: string };
  forum_topic_edited?: { name?: string };
  migrate_to_chat_id?: number;
  migrate_from_chat_id?: number;
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
  parameters?: {
    migrate_to_chat_id?: number;
  };
};

type AiGeneration = {
  id: number;
  prompt: string;
  target_ids: string;
  desired_count: number;
  batch_size: number;
  generated_count: number;
  model: string;
  previous_outputs: string;
  created_at: string;
  updated_at: string;
};

type GeneratedPostDraft = {
  text: string;
  pollOptions?: string[];
};

type ModerationAction = {
  id: number;
  target_id: number | null;
  chat_id: string;
  user_id: string;
  username: string | null;
  message_id: number | null;
  reason: string;
  excerpt: string | null;
  delete_ok: number;
  ban_ok: number;
  error: string | null;
  created_at: string;
};

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

const DEFAULT_MODERATION_RULES = [
  "No spam.",
  "No promotion for other courses, channels, groups, websites, or communities.",
  "No Telegram invite links or external links unless posted by this bot.",
  "No photos from members.",
  "Any bot account posting in the group is removed.",
  "Violations are deleted and the sender is banned silently."
].join("\n");

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

    const targetPhotoMatch = url.pathname.match(/^\/api\/targets\/(\d+)\/photo$/);
    if (targetPhotoMatch && request.method === "GET") return targetPhoto(Number(targetPhotoMatch[1]), env);

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
    if (url.pathname === "/api/ai/generations" && request.method === "POST") return createAiGeneration(request, env);

    const aiContinueMatch = url.pathname.match(/^\/api\/ai\/generations\/(\d+)\/continue$/);
    if (aiContinueMatch && request.method === "POST") return continueAiGeneration(Number(aiContinueMatch[1]), env);

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
    await enforceAutomaticModerationSettings(env);
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
  const sourceMessage = update.message ?? update.channel_post;
  const chat = sourceMessage?.chat ?? update.my_chat_member?.chat;
  if (!chat || chat.type === "private") return json({ ok: true });

  if (sourceMessage?.migrate_to_chat_id) {
    await migrateChatId(env, String(chat.id), String(sourceMessage.migrate_to_chat_id));
    return json({ ok: true });
  }

  const target = await upsertTargetFromChat(chat, sourceMessage, env);
  const text = sourceMessage?.text ?? "";
  if (text.startsWith("/register")) {
    const payload: Record<string, unknown> = {
      chat_id: String(chat.id),
      text: `Registered ${target.title} in TG88.`
    };
    if (target.thread_id > 0) payload.message_thread_id = target.thread_id;
    await telegramRequest(env, "sendMessage", payload);
    return json({ ok: true });
  }

  if (sourceMessage && update.message) await moderateTelegramMessage(env, target, sourceMessage);
  return json({ ok: true });
}

async function upsertTargetFromChat(chat: TelegramChat, message: TelegramMessage | undefined, env: Env): Promise<Target> {
  const now = new Date().toISOString();
  const chatId = String(chat.id);
  const baseTitle = chat.title ?? chat.username ?? [chat.first_name, chat.last_name].filter(Boolean).join(" ") ?? chatId;
  const rawThreadId = message?.message_thread_id ?? 0;
  const threadId = rawThreadId === 1 ? 0 : rawThreadId;
  const topicName = message?.forum_topic_created?.name ?? message?.forum_topic_edited?.name ?? null;
  const title = threadId > 0 ? `${baseTitle} / ${topicName ?? `Topic ${threadId}`}` : baseTitle;
  const type = chat.type === "channel" ? "channel" : "group";
  const photoFileId = chat.photo?.small_file_id ?? null;
  const photoUpdatedAt = photoFileId ? now : null;

  await env.DB.prepare(
    `INSERT INTO targets (title, chat_id, thread_id, topic_name, type, moderation_enabled, moderation_rules, photo_file_id, photo_updated_at, source, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'telegram', ?)
     ON CONFLICT(chat_id, thread_id) DO UPDATE SET
       title = excluded.title,
       topic_name = COALESCE(excluded.topic_name, targets.topic_name),
       type = excluded.type,
       photo_file_id = COALESCE(excluded.photo_file_id, targets.photo_file_id),
       photo_updated_at = COALESCE(excluded.photo_updated_at, targets.photo_updated_at),
       moderation_enabled = CASE WHEN excluded.type = 'group' THEN 1 ELSE targets.moderation_enabled END,
       moderation_rules = CASE
         WHEN excluded.type = 'group' AND targets.moderation_rules = '' THEN excluded.moderation_rules
         ELSE targets.moderation_rules
       END,
       source = 'telegram',
       last_seen_at = excluded.last_seen_at`
  ).bind(title, chatId, threadId, topicName, type, type === "group" ? 1 : 0, DEFAULT_MODERATION_RULES, photoFileId, photoUpdatedAt, now).run();

  const target = await env.DB.prepare("SELECT * FROM targets WHERE chat_id = ? AND thread_id = ?")
    .bind(chatId, threadId)
    .first<Target>();
  if (!target) throw new Error("Target registration failed");
  return target;
}

async function migrateChatId(env: Env, oldChatId: string, newChatId: string): Promise<void> {
  const existingNew = await env.DB.prepare("SELECT id FROM targets WHERE chat_id = ? AND thread_id = 0")
    .bind(newChatId)
    .first<{ id: number }>();

  const oldTarget = await env.DB.prepare("SELECT id FROM targets WHERE chat_id = ? AND thread_id = 0")
    .bind(oldChatId)
    .first<{ id: number }>();

  if (existingNew && oldTarget) {
    await env.DB.prepare("UPDATE messages SET target_id = ? WHERE target_id = ?").bind(existingNew.id, oldTarget.id).run();
    await env.DB.prepare("UPDATE target_metrics SET target_id = ? WHERE target_id = ?").bind(existingNew.id, oldTarget.id).run();
    await env.DB.prepare("DELETE FROM targets WHERE id = ?").bind(oldTarget.id).run();
    return;
  }

  await env.DB.prepare("UPDATE targets SET chat_id = ? WHERE chat_id = ?").bind(newChatId, oldChatId).run();
}

async function enforceAutomaticModerationSettings(env: Env): Promise<void> {
  await env.DB.prepare(
    `UPDATE targets
     SET moderation_enabled = 1,
         moderation_rules = CASE WHEN moderation_rules = '' THEN ? ELSE moderation_rules END
     WHERE type = 'group'`
  ).bind(DEFAULT_MODERATION_RULES).run();
}

async function syncTargetProfiles(env: Env): Promise<void> {
  const staleBefore = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const targets = await env.DB.prepare(
    `SELECT id, chat_id, title, photo_updated_at
     FROM targets
     WHERE enabled = 1
       AND thread_id = 0
       AND (photo_updated_at IS NULL OR photo_updated_at < ?)
     ORDER BY COALESCE(photo_updated_at, created_at) ASC
     LIMIT 10`
  ).bind(staleBefore).all<{ id: number; chat_id: string; title: string; photo_updated_at: string | null }>();

  for (const target of targets.results ?? []) {
    const chat = await telegramRequest<TelegramChat>(env, "getChat", { chat_id: target.chat_id });
    const now = new Date().toISOString();
    if (!chat.ok) {
      await env.DB.prepare("UPDATE targets SET photo_updated_at = ? WHERE id = ?").bind(now, target.id).run();
      continue;
    }

    await env.DB.prepare(
      `UPDATE targets
       SET title = COALESCE(?, title),
           photo_file_id = ?,
           photo_updated_at = ?
       WHERE id = ?`
    )
      .bind(chat.result?.title ?? chat.result?.username ?? target.title, chat.result?.photo?.small_file_id ?? null, now, target.id)
      .run();
  }
}

async function targetPhoto(id: number, env: Env): Promise<Response> {
  const target = await env.DB.prepare("SELECT photo_file_id FROM targets WHERE id = ? AND enabled = 1")
    .bind(id)
    .first<{ photo_file_id: string | null }>();
  if (!target?.photo_file_id) return new Response(null, { status: 404 });

  const file = await telegramRequest<TelegramFile>(env, "getFile", { file_id: target.photo_file_id });
  if (!file.ok || !file.result?.file_path || !env.TELEGRAM_BOT_TOKEN) return new Response(null, { status: 404 });

  const image = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.result.file_path}`);
  if (!image.ok) return new Response(null, { status: 404 });

  return new Response(image.body, {
    headers: {
      "content-type": inferTelegramFileContentType(file.result.file_path, image.headers.get("content-type")),
      "cache-control": "public, max-age=3600"
    }
  });
}

function inferTelegramFileContentType(filePath: string, fallback: string | null): string {
  if (/\.(jpe?g)$/i.test(filePath)) return "image/jpeg";
  if (/\.png$/i.test(filePath)) return "image/png";
  if (/\.webp$/i.test(filePath)) return "image/webp";
  return fallback && fallback !== "application/octet-stream" ? fallback : "image/jpeg";
}

async function moderateTelegramMessage(env: Env, target: Target, message: TelegramMessage): Promise<void> {
  if (target.type !== "group" || target.moderation_enabled !== 1) return;

  for (const member of message.new_chat_members ?? []) {
    if (member.is_bot) {
      await enforceModeration(env, target, message, member, "bot_joined_group", "New bot account joined the group");
    }
  }

  if (!message.from) return;
  const check = classifyModerationViolation(message);
  if (!check) return;
  await enforceModeration(env, target, message, message.from, check.reason, check.excerpt);
}

function classifyModerationViolation(message: TelegramMessage): { reason: string; excerpt: string } | null {
  const text = extractMessageText(message);
  const excerpt = cleanText(text, 500);

  if (message.from?.is_bot) return { reason: "bot_sender", excerpt: excerpt || "Bot account posted in group" };
  if ((message.photo?.length ?? 0) > 0) return { reason: "photo_posted", excerpt: excerpt || "Photo message" };
  if (hasUrlEntity(message) || hasBlockedLink(text)) return { reason: "blocked_link", excerpt };
  if (hasPromotionText(text)) return { reason: "promotion_or_invite", excerpt };

  return null;
}

async function enforceModeration(
  env: Env,
  target: Target,
  message: TelegramMessage,
  user: TelegramUser,
  reason: string,
  excerpt: string
): Promise<void> {
  const chatId = String(message.chat.id);
  const userId = String(user.id);
  let deleteOk = false;
  let banOk = false;
  const errors: string[] = [];

  const deleteResult = await telegramRequest<boolean>(env, "deleteMessage", {
    chat_id: chatId,
    message_id: message.message_id
  });
  deleteOk = deleteResult.ok === true;
  if (!deleteResult.ok && deleteResult.description) errors.push(`delete: ${deleteResult.description}`);

  const banResult = await telegramRequest<boolean>(env, "banChatMember", {
    chat_id: chatId,
    user_id: user.id,
    revoke_messages: true
  });
  banOk = banResult.ok === true;
  if (!banResult.ok && banResult.description) errors.push(`ban: ${banResult.description}`);

  await env.DB.prepare(
    `INSERT INTO moderation_actions (
      target_id,
      chat_id,
      user_id,
      username,
      message_id,
      reason,
      excerpt,
      delete_ok,
      ban_ok,
      error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      target.id,
      chatId,
      userId,
      formatUsername(user),
      message.message_id,
      reason,
      cleanText(excerpt, 500),
      deleteOk ? 1 : 0,
      banOk ? 1 : 0,
      errors.length > 0 ? errors.join("; ") : null
    )
    .run();
}

function extractMessageText(message: TelegramMessage): string {
  return [message.text, message.caption].filter(Boolean).join("\n");
}

function hasUrlEntity(message: TelegramMessage): boolean {
  return [...(message.entities ?? []), ...(message.caption_entities ?? [])].some((entity) =>
    entity.type === "url" || entity.type === "text_link" || Boolean(entity.url)
  );
}

function hasBlockedLink(text: string): boolean {
  return /(?:https?:\/\/|www\.|t\.me\/|telegram\.me\/|telegram\.dog\/|tg:\/\/|chat\.whatsapp\.com\/|wa\.me\/|discord\.gg\/|bit\.ly\/|linktr\.ee\/)/i.test(text);
}

function hasPromotionText(text: string): boolean {
  return /(?:(?:join|subscribe|follow|visit|check out|dm me|message me|contact me|invite).{0,50}(?:course|class|signals?|community|channel|group|site|website|telegram|whatsapp)|(?:course|class|signals?).{0,50}(?:join|subscribe|dm|contact|link|group|channel)|(?:اشترك|تابع|انضم|راسلني).{0,50}(?:دورة|كورس|قروب|مجموعة|قناة|رابط))/i.test(text);
}

function formatUsername(user: TelegramUser): string {
  const handle = user.username ? `@${user.username}` : "";
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ");
  return handle || name || String(user.id);
}

async function listTargets(env: Env): Promise<Response> {
  await enforceAutomaticModerationSettings(env);
  await syncTargetProfiles(env);
  await syncTargetMetrics(env);

  const targets = await env.DB.prepare(
    `SELECT id, title, chat_id, thread_id, topic_name, type, enabled, rules, moderation_enabled, moderation_rules, photo_file_id, photo_updated_at, source, last_seen_at, created_at
     FROM targets
     WHERE enabled = 1
     ORDER BY COALESCE(last_seen_at, created_at) DESC`
  ).all<Target>();

  const messages = await env.DB.prepare(
    `SELECT messages.*, targets.title AS target_title, targets.chat_id, targets.thread_id
     FROM messages
     JOIN targets ON targets.id = messages.target_id
     ORDER BY messages.updated_at DESC
     LIMIT 500`
  ).all<ScheduledMessage>();

  const metrics = await env.DB.prepare(
    "SELECT target_id, member_count, view_count, captured_at FROM target_metrics ORDER BY captured_at DESC"
  ).all<TargetMetric>();

  const moderationActions = await env.DB.prepare(
    `SELECT *
     FROM moderation_actions
     ORDER BY created_at DESC
     LIMIT 200`
  ).all<ModerationAction>();

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

  const moderationByTarget = new Map<number, ModerationAction[]>();
  for (const action of moderationActions.results ?? []) {
    if (!action.target_id) continue;
    const list = moderationByTarget.get(action.target_id) ?? [];
    list.push(action);
    moderationByTarget.set(action.target_id, list);
  }

  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  return json({
    targets: (targets.results ?? []).map((target) => {
      const targetMessages = messagesByTarget.get(target.id) ?? [];
      const targetMetrics = metricsByTarget.get(target.id) ?? [];
      const targetActions = moderationByTarget.get(target.id) ?? [];
      const latest = targetMetrics[0];
      const previous = targetMetrics.find((metric) => new Date(metric.captured_at).getTime() <= weekAgo);
      const memberHistory = buildHistory(targetMetrics, "member_count");
      const viewHistory = buildHistory(targetMetrics, "view_count");

      return {
        ...target,
        messages: targetMessages,
        moderation_rules: target.moderation_rules || DEFAULT_MODERATION_RULES,
        moderation_actions: targetActions.slice(0, 20),
        moderation_action_count: targetActions.length,
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
    `INSERT INTO targets (title, chat_id, thread_id, type, moderation_enabled, moderation_rules)
     VALUES (?, ?, 0, ?, ?, ?)
     ON CONFLICT(chat_id, thread_id) DO UPDATE SET
       title = excluded.title,
       type = excluded.type,
       moderation_enabled = CASE WHEN excluded.type = 'group' THEN 1 ELSE targets.moderation_enabled END,
       moderation_rules = CASE
         WHEN excluded.type = 'group' AND targets.moderation_rules = '' THEN excluded.moderation_rules
         ELSE targets.moderation_rules
       END`
  ).bind(title, chatId, type, type === "group" ? 1 : 0, DEFAULT_MODERATION_RULES).run();

  return listTargets(env);
}

async function updateTarget(id: number, request: Request, env: Env): Promise<Response> {
  const input = await readJson<{ rules?: string; title?: string }>(request);
  const rules = cleanText(input.rules ?? "", 8000);
  const title = cleanText(input.title ?? "", 80);

  if (title) {
    await env.DB.prepare(
      `UPDATE targets
       SET title = ?,
           rules = ?,
           moderation_enabled = CASE WHEN type = 'group' THEN 1 ELSE moderation_enabled END,
           moderation_rules = CASE WHEN type = 'group' AND moderation_rules = '' THEN ? ELSE moderation_rules END
       WHERE id = ?`
    )
      .bind(title, rules, DEFAULT_MODERATION_RULES, id)
      .run();
  } else {
    await env.DB.prepare(
      `UPDATE targets
       SET rules = ?,
           moderation_enabled = CASE WHEN type = 'group' THEN 1 ELSE moderation_enabled END,
           moderation_rules = CASE WHEN type = 'group' AND moderation_rules = '' THEN ? ELSE moderation_rules END
       WHERE id = ?`
    )
      .bind(rules, DEFAULT_MODERATION_RULES, id)
      .run();
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
        `SELECT messages.*, targets.title AS target_title, targets.chat_id, targets.thread_id
         FROM messages
         JOIN targets ON targets.id = messages.target_id
         WHERE messages.target_id = ?
         ORDER BY messages.updated_at DESC`
      ).bind(targetId)
    : env.DB.prepare(
        `SELECT messages.*, targets.title AS target_title, targets.chat_id, targets.thread_id
         FROM messages
         JOIN targets ON targets.id = messages.target_id
         ORDER BY messages.updated_at DESC
         LIMIT 500`
      );

  const messages = await query.all<ScheduledMessage>();
  return json({ messages: messages.results ?? [] });
}

type PostInput = {
  targetId?: number;
  body?: string;
  scheduledAt?: string;
  kind?: string;
  pollOptions?: string[];
  linkPreviewEnabled?: boolean;
  repeatCount?: number;
  repeatIntervalMinutes?: number;
};

type NormalizedPostInput = {
  body: string;
  kind: "text" | "poll";
  pollOptionsJson: string | null;
  linkPreviewEnabled: boolean;
  repeatCount: number;
  repeatIntervalMinutes: number;
  repeatGroupId: string | null;
};

function normalizePostInput(input: PostInput): NormalizedPostInput {
  const kind = input.kind === "poll" ? "poll" : "text";
  const pollOptions = (input.pollOptions ?? [])
    .map((option) => cleanText(option, 100))
    .filter(Boolean)
    .slice(0, 10);
  const body = cleanText(input.body, kind === "poll" ? 300 : 4096);
  const repeatCount = Math.max(1, Math.min(30, Math.floor(Number(input.repeatCount ?? 1))));
  const repeatIntervalMinutes = Math.max(1, Math.min(43200, Math.floor(Number(input.repeatIntervalMinutes ?? 1440))));

  return {
    body,
    kind,
    pollOptionsJson: kind === "poll" ? JSON.stringify(pollOptions) : null,
    linkPreviewEnabled: input.linkPreviewEnabled !== false,
    repeatCount,
    repeatIntervalMinutes,
    repeatGroupId: repeatCount > 1 ? crypto.randomUUID() : null
  };
}

function validatePostInput(input: NormalizedPostInput): string | null {
  if (!input.body) return "Write a post first";
  if (input.kind === "poll") {
    const options = parsePollOptions(input.pollOptionsJson);
    if (options.length < 2) return "Poll needs at least two options";
  }
  return null;
}

function parsePollOptions(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((option) => cleanText(option, 100)).filter(Boolean).slice(0, 10) : [];
  } catch {
    return [];
  }
}

async function insertRepeatedMessages(
  env: Env,
  targetId: number,
  draft: NormalizedPostInput,
  firstScheduledAt: string,
  status: MessageStatus
): Promise<void> {
  const validationError = validatePostInput(draft);
  if (validationError) throw new Error(validationError);

  const start = new Date(firstScheduledAt).getTime();
  const batchId = crypto.randomUUID();
  for (let index = 0; index < draft.repeatCount; index += 1) {
    const scheduledAt = new Date(start + index * draft.repeatIntervalMinutes * 60_000).toISOString();
    await insertMessage(env, targetId, draft, scheduledAt, status, batchId, index);
  }
}

async function createMessage(request: Request, env: Env): Promise<Response> {
  const input = await readJson<PostInput>(request);
  const draft = normalizePostInput(input);
  const scheduledAt = normalizeDate(input.scheduledAt);

  if (!input.targetId || !draft.body || !scheduledAt) {
    return json({ error: "Target, message, and schedule time are required" }, 400);
  }

  if (!(await targetExists(env, input.targetId))) return json({ error: "Target not found" }, 404);

  const validationError = validatePostInput(draft);
  if (validationError) return json({ error: validationError }, 400);

  await insertRepeatedMessages(env, input.targetId, draft, scheduledAt, "pending");
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
    await insertMessage(
      env,
      input.targetId,
      {
        body: bodies[index],
        kind: "text",
        pollOptionsJson: null,
        linkPreviewEnabled: true,
        repeatCount: 1,
        repeatIntervalMinutes: 0,
        repeatGroupId: null
      },
      scheduledAt,
      "pending",
      batchId
    );
  }

  return listTargets(env);
}

async function saveDraft(request: Request, env: Env): Promise<Response> {
  const input = await readJson<PostInput & { draftId?: number }>(request);
  const draftInput = normalizePostInput(input);
  const now = new Date().toISOString();

  if (!input.targetId) return json({ error: "Target is required" }, 400);
  if (!(await targetExists(env, input.targetId))) return json({ error: "Target not found" }, 404);

  if (!draftInput.body) {
    if (input.draftId) await env.DB.prepare("DELETE FROM messages WHERE id = ? AND status = 'draft'").bind(input.draftId).run();
    return json({ draft: null });
  }

  const validationError = validatePostInput(draftInput);
  if (validationError) return json({ error: validationError }, 400);

  const existing = input.draftId
    ? await env.DB.prepare("SELECT * FROM messages WHERE id = ? AND target_id = ? AND status = 'draft'")
        .bind(input.draftId, input.targetId)
        .first<ScheduledMessage>()
    : null;

  if (existing) {
    await env.DB.prepare(
      `UPDATE messages
       SET body = ?, scheduled_at = ?, kind = ?, poll_options = ?, link_preview_enabled = ?, updated_at = ?
       WHERE id = ?`
    )
      .bind(
        draftInput.body,
        now,
        draftInput.kind,
        draftInput.pollOptionsJson,
        draftInput.linkPreviewEnabled ? 1 : 0,
        now,
        existing.id
      )
      .run();
    const draft = await env.DB.prepare("SELECT * FROM messages WHERE id = ?").bind(existing.id).first<ScheduledMessage>();
    return json({ draft });
  }

  await insertRepeatedMessages(env, input.targetId, draftInput, now, "draft");
  const draft = await env.DB.prepare(
    "SELECT * FROM messages WHERE target_id = ? AND status = 'draft' ORDER BY id DESC LIMIT 1"
  ).bind(input.targetId).first<ScheduledMessage>();
  return json({ draft });
}

async function createAiGeneration(request: Request, env: Env): Promise<Response> {
  const input = await readJson<{
    prompt?: string;
    targetIds?: number[];
    desiredCount?: number;
    batchSize?: number;
    model?: string;
    kind?: string;
  }>(request);

  const kind = input.kind === "poll" ? "poll" : "text";
  const rawPrompt = cleanText(input.prompt, 11950);
  const prompt = cleanText(`${rawPrompt}\n\nContent type: ${kind}.`, 12000);
  const targetIds = sanitizeTargetIds(input.targetIds);
  const desiredCount = Math.max(3, Math.min(500, Math.floor(Number(input.desiredCount ?? 100))));
  const batchSize = Math.max(1, Math.min(10, Math.floor(Number(input.batchSize ?? 3))));
  const model = cleanText(input.model, 120) || env.OPENROUTER_MODEL || "~openai/gpt-latest";

  if (!rawPrompt) return json({ error: "Prompt is required" }, 400);
  if (targetIds.length === 0) return json({ error: "Choose at least one channel or group" }, 400);
  if (!(await targetsExist(env, targetIds))) return json({ error: "One or more selected chats no longer exist" }, 400);

  const now = new Date().toISOString();
  const created = await env.DB.prepare(
    `INSERT INTO ai_generations (prompt, target_ids, desired_count, batch_size, model, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(prompt, JSON.stringify(targetIds), desiredCount, batchSize, model, now).run();

  const id = Number(created.meta.last_row_id);
  return runAiGenerationBatch(id, env);
}

async function continueAiGeneration(id: number, env: Env): Promise<Response> {
  return runAiGenerationBatch(id, env);
}

async function runAiGenerationBatch(id: number, env: Env): Promise<Response> {
  try {
    const generation = await env.DB.prepare("SELECT * FROM ai_generations WHERE id = ?")
      .bind(id)
      .first<AiGeneration>();

    if (!generation) return json({ error: "Generation not found" }, 404);
    if (generation.generated_count >= generation.desired_count) {
      return json({ generation, posts: [], done: true });
    }

    const targetIds = parseNumberArray(generation.target_ids);
    const previousOutputs = parseStringArray(generation.previous_outputs);
    const remaining = Math.max(0, generation.desired_count - generation.generated_count);
    const count = Math.min(generation.batch_size, remaining);
    const targets = await getTargetsByIds(env, targetIds);
    const kind = generation.prompt.includes("Content type: poll.") ? "poll" : "text";
    const generated = await generatePostsWithOpenRouter(env, generation, targets, previousOutputs, count, kind);

    const now = new Date().toISOString();
    for (const targetId of targetIds) {
      for (const post of generated) {
        await insertMessage(
          env,
          targetId,
          {
            body: post.text,
            kind,
            pollOptionsJson: kind === "poll" ? JSON.stringify((post.pollOptions ?? ["Yes", "No"]).slice(0, 10)) : null,
            linkPreviewEnabled: true,
            repeatCount: 1,
            repeatIntervalMinutes: 1440,
            repeatGroupId: null
          },
          now,
          "draft"
        );
      }
    }

    const nextOutputs = [...previousOutputs, ...generated.map((post) => post.text)].slice(-80);
    const nextCount = generation.generated_count + generated.length;
    await env.DB.prepare(
      `UPDATE ai_generations
       SET generated_count = ?, previous_outputs = ?, updated_at = ?
       WHERE id = ?`
    ).bind(nextCount, JSON.stringify(nextOutputs), now, id).run();

    const updated = await env.DB.prepare("SELECT * FROM ai_generations WHERE id = ?").bind(id).first<AiGeneration>();
    return json({ generation: updated, posts: generated, done: nextCount >= generation.desired_count });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "AI generation failed" }, 502);
  }
}

async function generatePostsWithOpenRouter(
  env: Env,
  generation: AiGeneration,
  targets: Target[],
  previousOutputs: string[],
  count: number,
  kind: "text" | "poll"
): Promise<GeneratedPostDraft[]> {
  if (!env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }

  const targetContext = targets.map((target) => ({
    title: target.title,
    chat_id: target.chat_id,
    topic: target.topic_name,
    rules: target.rules
  }));

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${env.OPENROUTER_API_KEY}`,
      "content-type": "application/json",
      "http-referer": "https://tg88.mousab-r.workers.dev",
      "x-openrouter-title": "TG88"
    },
    body: JSON.stringify({
      model: generation.model,
      messages: [
        {
          role: "system",
          content:
            "You write concise Telegram content. Return only valid JSON. For text use {\"posts\":[{\"text\":\"...\"}]}. For polls use {\"posts\":[{\"text\":\"Poll question\",\"pollOptions\":[\"Option A\",\"Option B\"]}]}. No markdown. No explanations. Each item must be distinct and ready to publish."
        },
        {
          role: "user",
          content: JSON.stringify({
            task: `Generate exactly ${count} new Telegram ${kind === "poll" ? "polls" : "posts"}.`,
            prompt: generation.prompt,
            target_chats: targetContext,
            previous_posts_to_avoid: previousOutputs.slice(-30)
          })
        }
      ],
      temperature: 0.85,
      response_format: { type: "json_object" }
    })
  });

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(data.error?.message ?? "OpenRouter request failed");
  }

  const content = data.choices?.[0]?.message?.content ?? "";
  const parsed = parseGeneratedPosts(content, kind);
  if (parsed.length === 0) throw new Error("OpenRouter returned no posts");
  return parsed.slice(0, count);
}

function parseGeneratedPosts(content: string, kind: "text" | "poll"): GeneratedPostDraft[] {
  try {
    const parsed = JSON.parse(content);
    const posts = Array.isArray(parsed.posts) ? parsed.posts : [];
    return posts
      .map((post: { text?: unknown; pollOptions?: unknown }) => {
        const text = cleanText(post.text, kind === "poll" ? 300 : 900);
        if (!text) return null;
        const pollOptions = Array.isArray(post.pollOptions)
          ? post.pollOptions.map((option) => cleanText(option, 100)).filter(Boolean).slice(0, 10)
          : [];
        return {
          text,
          pollOptions: kind === "poll" && pollOptions.length >= 2 ? pollOptions : undefined
        };
      })
      .filter((post: GeneratedPostDraft | null): post is GeneratedPostDraft => Boolean(post));
  } catch {
    return [];
  }
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
  draft: NormalizedPostInput,
  scheduledAt: string,
  status: MessageStatus,
  batchId: string | null = null,
  repeatIndex = 0
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO messages (
      target_id,
      body,
      scheduled_at,
      status,
      batch_id,
      kind,
      poll_options,
      link_preview_enabled,
      repeat_group_id,
      repeat_index
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      targetId,
      draft.body,
      scheduledAt,
      status,
      batchId,
      draft.kind,
      draft.pollOptionsJson,
      draft.linkPreviewEnabled ? 1 : 0,
      draft.repeatGroupId,
      repeatIndex
    )
    .run();
}

async function targetExists(env: Env, targetId: number): Promise<boolean> {
  const target = await env.DB.prepare("SELECT id FROM targets WHERE id = ? AND enabled = 1")
    .bind(targetId)
    .first<{ id: number }>();
  return Boolean(target);
}

async function targetsExist(env: Env, targetIds: number[]): Promise<boolean> {
  if (targetIds.length === 0) return false;
  const placeholders = targetIds.map(() => "?").join(",");
  const result = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM targets WHERE enabled = 1 AND id IN (${placeholders})`
  ).bind(...targetIds).first<{ count: number }>();
  return result?.count === targetIds.length;
}

async function getTargetsByIds(env: Env, targetIds: number[]): Promise<Target[]> {
  if (targetIds.length === 0) return [];
  const placeholders = targetIds.map(() => "?").join(",");
  const targets = await env.DB.prepare(
    `SELECT id, title, chat_id, thread_id, topic_name, type, enabled, rules, moderation_enabled, moderation_rules, source, last_seen_at, created_at
     FROM targets
     WHERE enabled = 1 AND id IN (${placeholders})`
  ).bind(...targetIds).all<Target>();
  return targets.results ?? [];
}

function sanitizeTargetIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0))].slice(0, 50);
}

function parseNumberArray(value: string): number[] {
  try {
    return sanitizeTargetIds(JSON.parse(value));
  } catch {
    return [];
  }
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => cleanText(item, 1200)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

async function deleteMessage(id: number, env: Env): Promise<Response> {
  await env.DB.prepare("DELETE FROM messages WHERE id = ? AND status != 'posting'").bind(id).run();
  return listTargets(env);
}

async function postOneMessage(id: number, env: Env): Promise<Response> {
  const message = await env.DB.prepare(
    `SELECT messages.*, targets.chat_id, targets.thread_id, targets.title AS target_title
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
    `SELECT messages.*, targets.chat_id, targets.thread_id, targets.title AS target_title
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

  const sent = await sendTelegramPost(env, message);

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

  if (sent.parameters?.migrate_to_chat_id && message.chat_id) {
    await migrateChatId(env, message.chat_id, String(sent.parameters.migrate_to_chat_id));
  }
}

async function sendTelegramPost(env: Env, message: ScheduledMessage): Promise<TelegramResponse<{ message_id: number; views?: number }>> {
  const basePayload: Record<string, unknown> = {
    chat_id: message.chat_id
  };
  if ((message.thread_id ?? 0) > 1) basePayload.message_thread_id = message.thread_id;

  if (message.kind === "poll") {
    return telegramRequest(env, "sendPoll", {
      ...basePayload,
      question: message.body,
      options: parsePollOptions(message.poll_options),
      is_anonymous: false
    });
  }

  return telegramRequest(env, "sendMessage", {
    ...basePayload,
    text: message.body,
    link_preview_options: {
      is_disabled: message.link_preview_enabled === 0
    }
  });
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
