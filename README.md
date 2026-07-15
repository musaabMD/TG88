# TG88

Telegram autoposter for channels and groups, built for Cloudflare Workers + D1.

## What it does

- Keep a list of Telegram channels/groups.
- Schedule messages per channel/group.
- Post due messages from a Cloudflare cron trigger.
- Show whether each message is pending, posted, posting, or failed.

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

5. Run locally:

```bash
npm run dev
```

6. Deploy:

```bash
npm run deploy
```

## Telegram notes

- Add the bot to each channel or group before scheduling messages.
- For channels, make the bot an admin with permission to post messages.
- Use a public channel/group username like `@my_channel`, or the numeric chat ID.
