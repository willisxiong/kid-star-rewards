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

- Astro 5 with `@astrojs/cloudflare`, which builds a Pages worker at `dist/_worker.js`
- [Hono](https://hono.dev/) for `/api` and `/auth/verify`, mounted from `src/middleware.ts`
- Cloudflare D1 binding `DB`

Pages advanced mode uses that single worker. A `functions/` directory would be ignored next to `_worker.js`, so the API stays inside the worker instead of a separate Functions folder.

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

Set these in `.dev.vars` locally. On Pages, set them as project secrets or variables (dashboard, or `wrangler pages secret put <NAME> --project-name kid-star-rewards`). Do not put `SESSION_SECRET` in `wrangler.jsonc`.

| Name | Required | Purpose |
|---|---|---|
| `SESSION_SECRET` | yes | HMAC material for session and magic-link token hashes. At least 16 characters. |
| `MAGIC_LINK_DEV_ECHO` | no | `1` returns the magic link in the JSON response and logs it. Use only while email is not configured. |
| `RESEND_API_KEY` | no | Sends the magic link with [Resend](https://resend.com/). |
| `EMAIL_FROM` | no | From address. Resend's onboarding sender can only mail the Resend account owner until a domain is verified. |
| `MAILCHANNELS` | no | `1` tries the Mailchannels send API when Resend is unset or fails. |
| `APP_ORIGIN` | no | Public origin used inside the email link, for example `https://kid-star-rewards.pages.dev`. Defaults to the request origin. |

Mail order: Resend, then Mailchannels, then the Worker log. The log line looks like `[kid-star] magic link for parent@example.com: https://...`. `wrangler pages deployment tail` shows it on Pages.

Sessions are HttpOnly, `SameSite=Lax` cookies (`ks_session`). Parent sessions last 14 days. Child device sessions last 180 days. Kid routes reject parent cookies and parent routes reject child cookies. One browser profile holds one session: binding a child device on a browser that was logged in as a parent replaces that cookie.

## Deploy to Cloudflare Pages

The agent environment here has no Cloudflare API token, so this repo does not publish a `*.pages.dev` URL. Willis needs to create the D1 database and the Pages project in the dashboard (or with Wrangler logged into the right account). Keep the project name `kid-star-rewards` so it stays separate from other products. Do not attach a custom domain if the release should stay on `*.pages.dev`.

1. `npx wrangler login` (account that should own this product).
2. `npx wrangler d1 create kid-star-rewards`
3. Put the printed database id into **both** `database_id` and `preview_database_id` in `wrangler.jsonc`. Using one database for production and preview keeps the single demo family in one place. Create a second database and point `preview_database_id` at it if preview deploys should stay isolated, then migrate and seed that database too.
4. `npx wrangler d1 migrations apply kid-star-rewards --remote`
5. `npx wrangler pages secret put SESSION_SECRET --project-name kid-star-rewards`
6. Optional: `RESEND_API_KEY`, `EMAIL_FROM`, `APP_ORIGIN`. Set `MAGIC_LINK_DEV_ECHO` to `1` only until email works. Anyone who knows an invited address can request a link, and echo puts that link in the HTTP response.
7. `npm run deploy`

`npm run deploy` runs `astro build` and `wrangler pages deploy dist --project-name kid-star-rewards`. The first deploy creates the Pages project. The live URL is `https://kid-star-rewards.pages.dev` (Cloudflare may add an account suffix if that name is taken). Build output directory is `dist`. Compatibility date is `2026-11-05` with `nodejs_compat`.

After deploy, confirm in the Pages project settings that the D1 binding name is `DB`. `wrangler.jsonc` is the source of truth when you deploy with Wrangler. If the dashboard binding is missing, add D1 binding `DB` to the database from step 2 and redeploy.

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
