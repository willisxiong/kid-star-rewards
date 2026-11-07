# Kid Star Rewards

Closed-beta family star chart. A child checks in for stars and redeems rewards. Redemption freezes the stars until a parent approves (stars stay spent) or rejects (stars return). Kid and parent read the same Cloudflare D1 database.

This repository is only this product. It does not call, import, or deploy anything from other projects.

Routes are `/kid` and `/parent`, plus `/` as a door and `/api/*` + `/auth/verify` for the Hono API. There is no bottom navigation and no public signup.

## Demo family

Created by `migrations/0002_seed_demo.sql`. Caps are enforced in the schema: at most **2 parents** and **1 child** per family. One family code can bind any number of child devices.

| | |
|---|---|
| Family code | `STAR-4821` |
| Parents | `willis.parent1@example.com`, `willis.parent2@example.com` |
| Child | 小星 |
| Timezone | `Asia/Hong_Kong` (changeable on `/parent`) |
| Starting stars | 12 |
| Tasks | 自己刷牙 +2, 自己吃饭 +2, 收拾房间 +3, 完成作业 +5 |
| Rewards | 听一集故事 5, 吃冰淇淋 10, 看一集动画片 15, 买一个玩具 50 |

Both parents can approve or reject redemptions and manage tasks and rewards. New tasks and rewards show up on `/kid` (the page polls every few seconds).

Daily check-in is once per task per `local_date` in the family timezone. A second tap the same day does not add stars.

## Stack

- Astro 5 with `@astrojs/cloudflare` on Cloudflare Workers and [static assets](https://developers.cloudflare.com/workers/static-assets/). The adapter writes the Worker to `dist/_worker.js/index.js`. Wrangler uploads `./dist` as assets and binds them as `ASSETS`.
- [Hono](https://hono.dev/) for `/api` and `/auth/verify`, mounted from `src/middleware.ts`
- Cloudflare D1 binding `DB`

The API lives in that Worker. `public/.assetsignore` keeps `_worker.js` and the adapter's `_routes.json` out of the asset upload. Workers does not use `_routes.json`; requests that are not static files run the Worker, including `/api` and `/auth`.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:setup:local
npm run dev
```

Open `http://127.0.0.1:4321/kid` and `http://127.0.0.1:4321/parent`.

`npm run db:setup:local` applies `migrations/` to the local D1 database. The second migration inserts the demo family and is safe to leave applied. Reset by deleting `.wrangler/state` and running setup again.

With `MAGIC_LINK_DEV_ECHO=1`, requesting a link for an invited parent returns the URL on the page and prints it in the dev server log. Copy it into the same browser. Uninvited addresses get the same sentence and no link.

```bash
npm test
npm run check
npm run build
```

## Environment

Set these in `.dev.vars` locally. On the Worker, set them as secrets (dashboard, or `npx wrangler secret put <NAME>`). Do not put `SESSION_SECRET` in `wrangler.jsonc`. `wrangler secret put` deploys a new version immediately.

| Name | Required | Purpose |
|---|---|---|
| `SESSION_SECRET` | yes | HMAC material for session and magic-link token hashes. At least 16 characters. |
| `MAGIC_LINK_DEV_ECHO` | no | `1` returns the magic link in the JSON response and logs it. Use only while email is not configured. |
| `RESEND_API_KEY` | no | Sends the magic link with [Resend](https://resend.com/). |
| `EMAIL_FROM` | no | From address. Resend's onboarding sender can only mail the Resend account owner until a domain is verified. |
| `MAILCHANNELS` | no | `1` tries the Mailchannels send API when Resend is unset or fails. |
| `APP_ORIGIN` | no | Public origin used inside the email link, for example `https://kid-star-rewards.<account-subdomain>.workers.dev`. Defaults to the request origin. |

Mail order: Resend, then Mailchannels, then the Worker log. The log line looks like `[kid-star] magic link for parent@example.com: https://...`. `npx wrangler tail` shows it on the deployed Worker. If `MAILCHANNELS=1` and `EMAIL_FROM` is unset, the sender is `noreply@kid-star-rewards.workers.dev`. Set `EMAIL_FROM` to a verified address before relying on that path.

Sessions are HttpOnly, `SameSite=Lax` cookies (`ks_session`), with `Max-Age` and `Expires` set to the same lifetime. Parent sessions last 14 days. Child device sessions last 48 hours (database `expires_at` and the cookie). Binding a device is a document `POST` that answers `303` to `/kid` with `Set-Cookie` on that response. `/kid` reads the cookie while rendering: a valid child session paints the app, and a missing session paints the family-code form. API responses are `Cache-Control: private, no-store`, so a cached `401` cannot stand in for a later request that would succeed. Kid routes reject parent cookies and parent routes reject child cookies. One browser profile holds one session: binding a child device on a browser that was logged in as a parent replaces that cookie.

## Deploy to Cloudflare Workers

This is a Worker with static assets, not a Pages project. Do not run `wrangler pages deploy`.

The checked-in `database_id` and `preview_database_id` are the placeholder `00000000-0000-0000-0000-000000000000`. They are not a database. Replace both with the id printed by `wrangler d1 create` before the first deploy. This repository does not publish a URL from here. There is still no open registration.

The Worker name in `wrangler.jsonc` is `kid-star-rewards`. The live URL is `https://kid-star-rewards.<account-subdomain>.workers.dev` unless you attach a custom domain. Leave the custom domain off if the release should stay on `workers.dev`. The first `wrangler deploy` can ask you to register that account subdomain.

### Wrangler

1. `npx wrangler login` (account that should own this product).
2. `npx wrangler d1 create kid-star-rewards`
3. Put the printed database id into **both** `database_id` and `preview_database_id` in `wrangler.jsonc`. Using one database for production and preview keeps the single demo family in one place. Create a second database and point `preview_database_id` at it if preview deploys should stay isolated, then migrate and seed that database too.
4. `npx wrangler d1 migrations apply kid-star-rewards --remote`
5. `npx wrangler secret put SESSION_SECRET`
6. Optional: `npx wrangler secret put RESEND_API_KEY`, and the same command for `EMAIL_FROM` and `APP_ORIGIN`. Set `MAGIC_LINK_DEV_ECHO` to `1` only until email works. Anyone who knows an invited address can request a link, and echo puts that link in the HTTP response.
7. `npm run deploy`

`npm run deploy` runs `astro build`, then `wrangler deploy`. The Worker name comes from `wrangler.jsonc`. Build output is `dist`. `main` is `./dist/_worker.js/index.js`, so the build has to finish before deploy. Compatibility date is `2026-11-05`. That date already enables Node.js compatibility, so `nodejs_compat` is not set.

In the dashboard, secrets are **Workers & Pages** → the Worker → **Settings** → **Variables and Secrets** → **Add** → type **Secret**. Non-secret values can be plain variables the same way. `wrangler.jsonc` is the source of truth for the D1 binding when you deploy with Wrangler. After deploy, the Worker should show D1 binding `DB`.

### Workers Builds (Git)

1. In the Cloudflare dashboard, go to **Workers & Pages** → **Create application**, then choose GitHub or GitLab. Authenticate if asked.
2. Select this repository. Set the Worker name to `kid-star-rewards`. It must match `name` in `wrangler.jsonc` or the build fails. Production branch is `main`.
3. Build command: `npm run build`. Deploy command: `npx wrangler deploy`. Leave the deploy command as that default. Do not set it to `npm run deploy` while the build command is also `npm run build` (that builds twice) and do not use `wrangler pages deploy`.
4. Save and deploy. Pushes to `main` build and deploy. Preview builds for other branches stay off until you enable them under **Settings** → **Builds** → **Branch control**. The preview command for a new Worker is `npx wrangler preview`.

To connect the Git repo after a CLI deploy: open the `kid-star-rewards` Worker → **Settings** → **Builds** → **Connect**.

`/api/health` returns `{ "ok": true, "service": "kid-star-rewards" }`.

## Inviting another family

There is no registration API. Insert a family with SQL (remote: `wrangler d1 execute kid-star-rewards --remote --command "..."`). The parent trigger aborts a third parent. `children.family_id` is unique, so a second child row fails.

```sql
INSERT INTO families (id, name, timezone, family_code, star_balance, created_at)
VALUES ('fam_...', '家庭名', 'Asia/Hong_Kong', 'STAR-XXXX', 0, datetime('now'));
INSERT INTO parents (id, family_id, email, created_at) VALUES
  ('par_a', 'fam_...', 'one@example.com', datetime('now')),
  ('par_b', 'fam_...', 'two@example.com', datetime('now'));
INSERT INTO children (id, family_id, display_name, created_at)
VALUES ('chi_...', 'fam_...', '孩子昵称', datetime('now'));
```

Then add tasks and rewards from `/parent`, or with SQL.

## Behavior notes

- Redeem subtracts stars immediately and creates a pending redemption. Approve keeps them spent. Reject adds them back.
- Check-ins use the family timezone, default `Asia/Hong_Kong`.
- Kid and parent poll `GET /api/kid/state` and `GET /api/parent/state`.
- The empty reward form says `请输入有效的奖励名称与所需星数`. The task form keeps the task wording.
