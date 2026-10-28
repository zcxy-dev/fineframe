# Deploying to Cloudflare Pages

The site is a static export: `pnpm build` writes it to `out/`, and Cloudflare Pages serves those files. Nothing runs on a server.

## Pages project

1. In the Cloudflare dashboard, open **Workers & Pages** and select **Create application** → **Pages** → **Connect to Git**.
2. Select **GitHub**, choose `zcxy-dev/fineframe`, then **Install & Authorize** and **Begin setup**.
3. In **Set up builds and deployments**, enter:

   | Field | Value |
   |---|---|
   | Project name | `fineframe-website` |
   | Production branch | `main` |
   | Framework preset | None |
   | Build command | `pnpm install --frozen-lockfile --filter @video-editor/site && pnpm build` |
   | Build output directory | `out` |
   | Root directory (advanced) | `apps/site` |
   | Environment variable `SKIP_DEPENDENCY_INSTALL` | `1` |
   | Environment variable `NODE_VERSION` | `24` |

   Set the same for **Production** and **Preview**, with the two Supabase values in [Environment](#environment), which the build needs. Corepack prepares pnpm from the `packageManager` field of the repository's `package.json`. `SKIP_DEPENDENCY_INSTALL` skips the image's own install step, and the build command installs only this folder's dependencies from the repository's `pnpm-lock.yaml`. Do not set `PNPM_VERSION`.
4. Select **Save and Deploy**.
5. In **Settings** → **Build** → **Build watch paths**, include `apps/site/*`, so a change elsewhere in the repository neither builds nor deploys the site.

Every other branch pushed to the repository gets a public preview at `<branch>.<project>.pages.dev`. To turn previews off, set **Settings** → **Builds & deployments** → **Preview branch control** to **None**.

`out/404.html` is the page for any address the site does not have; Pages serves it with status 404.

## Domain

In the Pages project, select **Custom domains** → **Set up a domain**, enter `fineframe.app` and select **Continue**. The domain's DNS is on Cloudflare, so Pages adds its record itself once you confirm it.

## Environment

The build reads these public values; they end up in the browser, so none is a secret. Set each in the Pages project's **Settings → Variables and Secrets**, for Production and Preview, and in `.env.local` for development. The build needs the two Supabase values; Paddle's are needed only once billing is on.

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://nvpwglzrjiikoawpjaak.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_HlA6CkJjvqKysmpVgjZRdg_IM40gwBj`, the project's publishable key |
| `NEXT_PUBLIC_PADDLE_ENVIRONMENT` | `sandbox` or `production` |
| `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` | a client-side token, in Paddle's **Developer tools → Authentication** |
| `NEXT_PUBLIC_PADDLE_PRICE_MONTHLY` | the id (`pri_…`) of the US$15 monthly price |
| `NEXT_PUBLIC_PADDLE_PRICE_YEARLY` | the id (`pri_…`) of the US$120 yearly price |

## Supabase

The project is `nvpwglzrjiikoawpjaak`, in the Supabase organization Fineframe. Its schema, Edge Functions and Auth settings come from `supabase/`, with the [Supabase CLI](https://supabase.com/docs/guides/cli), after `supabase login`:

```bash
supabase link --project-ref nvpwglzrjiikoawpjaak
supabase db push
supabase functions deploy paddle-webhook --no-verify-jwt
supabase functions deploy paddle-portal --no-verify-jwt
supabase config push   # answer y for auth only
```

`config push` applies `supabase/config.toml` with its `[remotes.production]` overrides: the Site URL `https://fineframe.app`, the redirect URLs `https://fineframe.app/**`, confirmed emails, passwords of 8 characters or more, and the OAuth server with the authorization path `/authorize/`.

The app's OAuth client was registered once through Auth's admin API, as [ENTITLEMENT.md](ENTITLEMENT.md) shows for the local stack, with the project's secret key (`supabase projects api-keys --reveal`). It is listed in the dashboard's **Authentication → OAuth Apps**.

The Edge Functions' secrets, in **Edge Functions → Secrets** (or `supabase secrets set`):

| Secret | Value |
|---|---|
| `PADDLE_ENVIRONMENT` | `sandbox` or `production` |
| `PADDLE_WEBHOOK_SECRET` | the secret key of Paddle's notification destination, below |
| `PADDLE_API_KEY` | a Paddle API key, in **Developer tools → Authentication**, with the customer portal session write permission |

`config push` lists each setting it would change before asking. It leaves alone what `config.toml` does not declare, such as the Google provider and the SMTP server below.

In the dashboard, because their secrets stay out of the repository:

- **Authentication → Sign In / Providers → Google:** on, with the client id and secret of a Google OAuth client whose authorized redirect URI is `https://nvpwglzrjiikoawpjaak.supabase.co/auth/v1/callback`.
- **Authentication → Emails → SMTP Settings:** Resend, whose domain `fineframe.app` is verified with DNS records in Cloudflare: sender `noreply@fineframe.app`, name `Fineframe`, host `smtp.resend.com`, port `465`, username `resend`, and a Resend API key as the password. Supabase's own mailer sends only to the project team's addresses, at a few emails an hour.

## Paddle

In the Paddle dashboard (the sandbox at [sandbox-vendors.paddle.com](https://sandbox-vendors.paddle.com), the live account at [vendors.paddle.com](https://vendors.paddle.com)):

- **Catalog → Products:** the product Fineframe, with a recurring price of US$15 every month and one of US$120 every year.
- **Checkout → Checkout settings:** the default payment link `https://fineframe.app/en/pricing/`.
- **Developer tools → Notifications:** a destination at `https://nvpwglzrjiikoawpjaak.supabase.co/functions/v1/paddle-webhook` for the events `subscription.created`, `subscription.updated`, `subscription.activated`, `subscription.canceled`, `subscription.past_due`, `subscription.paused`, `subscription.resumed` and `subscription.trialing`.

## Billing on and off

Whether Fineframe charges is one switch, `billing_enabled` in the one row of `public.app_config`. While it is `false`, as during the free public beta, the pricing page shows "Coming soon" instead of the checkout, the account page shows "Free public beta", and the app lets every signed-in user in ([ENTITLEMENT.md](ENTITLEMENT.md)). With Paddle set up and its values in Pages, turn it on in the Supabase dashboard's **SQL Editor**:

```sql
update public.app_config set billing_enabled = true;
```

## From the sandbox to live

The sandbox and the live account are separate: each has its own products, prices, tokens, keys and notification destination. Set them up in the live account as above, then change the values that name the sandbox:

- in Pages, `NEXT_PUBLIC_PADDLE_ENVIRONMENT=production` and the live `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN`, `NEXT_PUBLIC_PADDLE_PRICE_MONTHLY` and `NEXT_PUBLIC_PADDLE_PRICE_YEARLY`, then deploy again;
- in Supabase's Edge Function secrets, `PADDLE_ENVIRONMENT=production` and the live `PADDLE_WEBHOOK_SECRET` and `PADDLE_API_KEY`.

Rows that sandbox purchases left in `subscriptions` stay until they are deleted.
