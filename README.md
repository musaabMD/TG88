# TG88

Telegram autoposter for channels and groups, built for Cloudflare Workers + D1.

## What it does

- Keep a list of Telegram channels/groups.
- Auto-register groups/channels when the bot receives a webhook update.
- Write posts in an X-style composer.
- Auto-save typed posts as drafts.
- Schedule or publish a draft to the selected channel/group.
- Post due messages from a Cloudflare cron trigger.
- Keep per-target posting rules/notes from the Channels & groups menu.
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

6. Deploy:

```bash
npm run deploy
```

7. Register the Telegram webhook:

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H "content-type: application/json" \
  --data '{
    "url": "https://tg88.mousab-r.workers.dev/telegram/webhook",
    "secret_token": "'"$TELEGRAM_WEBHOOK_SECRET"'",
    "allowed_updates": ["message", "channel_post", "my_chat_member"]
  }'
```

8. Run locally:

```bash
npm run dev
```

## Telegram notes

- Add the bot to each channel or group before scheduling messages.
- For channels, make the bot an admin with permission to post messages.
- Use a public channel/group username like `@my_channel`, or the numeric chat ID.
- Telegram bots cannot fetch a full list of joined groups/channels. To make an existing group appear after the webhook is set, send `/register@dn88appbot` in that group.
- View counts are shown only when Telegram returns them to the bot API response. For normal bot-sent messages this is often not available.
- Member counts use Telegram `getChatMemberCount`; the bot must still be in the group/channel.
- Weekly growth is measured from stored snapshots and compared against the 5% weekly goal.
