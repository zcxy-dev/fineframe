# Website

The website for [fineframe.app](https://fineframe.app): a static Next.js site in English and Traditional Chinese.

| Page | Path |
|---|---|
| Language picker | `/`, which sends the browser to `/zh-tw/` when its languages include Chinese and to `/en/` otherwise |
| Home | `/en/`, `/zh-tw/` |
| Download | `/<locale>/download/` |
| Pricing | `/<locale>/pricing/` |
| Terms of service, privacy policy, refund policy | `/<locale>/terms/`, `/<locale>/privacy/`, `/<locale>/refund/` |
| Credits for the footage | `/<locale>/credits/` |
| Sign in, create an account, reset the password | `/<locale>/signin/`, `/<locale>/signup/`, `/<locale>/reset/` |
| Account: the subscription, billing and downloads | `/<locale>/account/` |
| The app's sign-in | `/authorize/`, which picks a language as `/` does, then `/<locale>/authorize/` |

The text of every page is in [`content/en.ts`](content/en.ts) and [`content/zh-tw.ts`](content/zh-tw.ts). In it, `[label](/path/)` links to a page in the same language, and `[[text]]` is a placeholder still to be decided, shown marked on the page. [`content/content.test.ts`](content/content.test.ts) checks the copy's rules: no punctuation in headings, no exclamation marks, 你 rather than 您, and a space between Chinese and Latin text. The pages break Chinese lines only between phrases ([`lib/typeset.ts`](lib/typeset.ts), with [BudouX](https://github.com/google/budoux)); [DESIGN.md](DESIGN.md#typography) has the rules.

The site sets no cookies of its own and runs no analytics. A signed-in session is kept in the browser's local storage. Its fonts are served from the site itself; once billing is on, the pricing page loads Paddle.js from Paddle for the checkout. The example edits are served from the site; the installers from `downloads.fineframe.app`, under names that always hold the latest version.

## Accounts and payments

Everything runs in the browser, against two services:

- **Supabase** holds the accounts (Supabase Auth: email and password, and Google) and the `subscriptions` table. Its schema, row-level security and Edge Functions are in [`supabase/`](supabase/): the migrations in `supabase/migrations/`; in `supabase/functions/`, `paddle-webhook`, which keeps `subscriptions` up to date from Paddle's events, and `paddle-portal`, which opens Paddle's customer portal from the account page.
- **Paddle Billing** sells the subscription, once `billing_enabled` in `app_config` is on ([DEPLOY.md](DEPLOY.md#billing-on-and-off)). The pricing page then opens Paddle's checkout for a signed-in user, with their user id in the checkout's `custom_data`.

The desktop app signs in through the site and reads its own row of `subscriptions`: [ENTITLEMENT.md](ENTITLEMENT.md).

## Develop

With Node 24, pnpm (`corepack enable`), Docker and the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started), from this folder (`pnpm install` installs the whole workspace; the repository's `pnpm lint`, `pnpm typecheck` and `pnpm test` cover this folder too):

```bash
pnpm install
supabase start  # Supabase at http://127.0.0.1:54321, the emails it sends at http://127.0.0.1:54324
pnpm dev        # http://127.0.0.1:3000/en/
pnpm typecheck
pnpm test
```

`pnpm dev` and `pnpm build` need the public values in [`.env.example`](.env.example), in the environment or in a git-ignored `.env.local`, and stop with an error that names a missing Supabase one. [DEPLOY.md](DEPLOY.md#environment) says where each comes from.

`supabase functions serve` runs the Edge Functions on the local stack, with the secrets in [`supabase/functions/.env.example`](supabase/functions/.env.example) set in a git-ignored `supabase/functions/.env`. Paddle's sandbox reaches the webhook only at a public address, such as the Supabase project's.

The pages are styled with Tailwind CSS, and the home page's moving parts with [`components/home/home.css`](components/home/home.css); [DESIGN.md](DESIGN.md) is the design system.

`pnpm dev` and `pnpm build` first write the fonts into the git-ignored `public/fonts/` ([`scripts/fonts.ts`](scripts/fonts.ts)): Geist and Noto Sans TC, each cut to the characters the site's source uses. `pnpm build` writes the static site to `out/`. `pnpm preview` builds it and serves `out/` at http://127.0.0.1:4321 with Python's static file server.

Deploying: [DEPLOY.md](DEPLOY.md).
