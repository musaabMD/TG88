# TG88

Telegram autoposter for channels and groups, built for Cloudflare Workers + D1.

## What it does

- Keep a list of Telegram channels/groups.
- Auto-register groups/channels when the bot receives a webhook update.
- Generate Telegram post drafts with OpenRouter from one prompt.
- Start with the first 3 AI drafts, then continue generating more batches toward a goal.
- Schedule or publish a draft to the selected channel/group.
- Post due messages from a Cloudflare cron trigger.
- Pull Telegram group/channel logos and show them in the app.
- Show a Planner page with Posts and Calendar views.
- Track 30-day schedule coverage against the rule: at least 5 scheduled posts per day for every chat.
- Keep per-target posting rules/notes from the Channels & groups menu.
- Moderate large groups silently by deleting and banning spam, links, photos, bot accounts, and invite/course promotion.
- Filter posts by draft, scheduled, and published.
- Track post counts, Telegram member counts, and weekly growth snapshots.

## Cloudflare setup

1. Install dependencies:

```bash
npm install
```

2. Create the D1 database:

```bash
npx wrangler d1 create tg88-db
```

Copy the returned `database_id` into `wrangler.jsonc`.

3. Apply the database migration:

```bash
npx wrangler d1 migrations apply tg88-db --local
npx wrangler d1 migrations apply tg88-db --remote
```

4. Add the Telegram bot token as a Cloudflare secret:

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
```

5. Add a webhook secret as a Cloudflare secret:

```bash
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

6. Add the OpenRouter API key as a Cloudflare secret:

```bash
npx wrangler secret put OPENROUTER_API_KEY
```

Optionally set `OPENROUTER_MODEL` in `wrangler.jsonc` vars. If omitted, TG88 uses `~openai/gpt-latest`.

7. Deploy:

```bash
npm run deploy
```

8. Register the Telegram webhook:

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H "content-type: application/json" \
  --data '{
    "url": "https://tg88.mousab-r.workers.dev/telegram/webhook",
    "secret_token": "'"$TELEGRAM_WEBHOOK_SECRET"'",
    "allowed_updates": ["message", "channel_post", "my_chat_member"]
  }'
```

9. Run locally:

```bash
npm run dev
```

## AI generation flow

- Open the Post page.
- Select the target channels/groups.
- Enter the content prompt.
- Click Generate first to create the first 3 draft posts.
- Click Continue to create the next batch until the goal is reached. The default goal is 100 drafts.
- Review, schedule, or publish generated drafts from the Planner page.

## Planner

- Planner -> Calendar shows all channels/groups for the next 30 days.
- Each chat needs at least 5 scheduled posts per day.
- Coverage is capped per day, so 10 posts on one day does not cover a missing day.
- Planner -> Posts keeps the draft/scheduled/published list view.

## Telegram notes

- Add the bot to each channel or group before scheduling messages.
- For channels, make the bot an admin with permission to post messages.
- For group moderation, make the bot an admin with permission to delete messages and ban users.
- Disable bot privacy in BotFather if the moderator needs to inspect every group message.
- Use a public channel/group username like `@my_channel`, or the numeric chat ID.
- Telegram bots cannot fetch a full list of joined groups/channels. To make an existing group appear after the webhook is set, send `/register@dn88appbot` in that group.
- View counts are shown only when Telegram returns them to the bot API response. For normal bot-sent messages this is often not available.
- Member counts use Telegram `getChatMemberCount`; the bot must still be in the group/channel.
- Weekly growth is measured from stored snapshots and compared against the 5% weekly goal.

## Moderator rules

Group moderation is automatic for registered groups. The app keeps it enabled and applies the default policy without manual rule setup.

The webhook silently deletes the message and bans the sender when it sees:

- Bot accounts joining or posting.
- Photo messages from members.
- Telegram invite links, external URLs, WhatsApp/Discord/link shortener links.
- Promotion or invite language for other courses, channels, groups, communities, or websites.

The bot does not reply with warnings. Recent delete/ban results are logged in the app.

Telegram still requires the group owner to grant the bot admin permissions and to disable privacy mode in BotFather when full-message inspection is needed; those controls are not exposed to bots through the Bot API.
