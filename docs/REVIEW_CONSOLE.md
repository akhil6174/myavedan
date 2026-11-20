# Review console

Where a person checks every critical fact in a notice against the official PDF before it goes live.

- Staging: https://admin-staging.myavedan.in
- Production: https://admin.myavedan.in

The console is served by the API Worker on its own hostname. Reviewers sign in with Google (Better Auth, the same setup as TrutiAI). The admin API answers only on the console's hostname, and only for accounts with the **reviewer** or **admin** role.

## Roles

| Role | Can do |
| --- | --- |
| reader | Nothing in the console (every new Google account starts here) |
| reviewer | Review, edit, approve and publish notices; handle error reports |
| admin | Everything a reviewer can, plus the **Reviewers** page to give or remove access |

Emails listed in the `ADMIN_EMAILS` secret become admin when they sign in. To add a reviewer: ask them to sign in once, then change their role on the **Reviewers** page. Removing access signs them out immediately.

## How reviewing works

1. **Queue.** Drafts from the pipeline, soonest deadline first. Updates to live notices come before new notices with the same deadline. Error and warning counts come from the automatic checks.
2. **Review screen.** Notice text on the left, fields on the right.
   - **Show in notice** jumps to the cited page and highlights the quote.
   - "✓ quote found on that page" means the pipeline found the cited quote where it says. "✕ quote not found" means check this field with extra care.
   - **Critical** fields (dates, posts and vacancies, eligibility rules, fees, application and notice links) must each be approved or edited one by one. Non-critical fields can be approved in a group.
   - **Edit** replaces the value. Simple values are a text box; structured values are JSON. The original draft value stays in the history.
   - **Reject** a field when it is wrong in a way you can't fix here. A rejected field blocks publishing.
   - For updates to a live notice, fields that differ from the live version are marked **Changed since live version**.
3. **Decision.**
   - **Approve and publish** is enabled once every critical field is checked. The record is validated with the same rules the site uses; if anything fails (for example vacancies that don't add up), nothing is published and the reason is shown.
   - **Urgent** marks it for the next publish without waiting for the regular batch. Use it for date changes and deadline extensions.
   - **Send back** asks the pipeline to extract again. **Reject** means the document will never be published. Both need a reason.
4. **Error reports.** Reader reports, oldest first. Confirm, fix through a new version, then mark fixed, or mark "not an error".

Every action is stored with the reviewer's email and time.

## One-time setup: Google sign-in (account owner)

Same steps as TrutiAI, with MyAvedan's addresses.

### 1. Google OAuth client
1. Go to **console.cloud.google.com** → choose or create a project (for example `MyAvedan`).
2. **APIs & Services** → **OAuth consent screen**: app name `MyAvedan`, your support email, audience **External**. Add yourself as a test user while it is in testing.
3. **APIs & Services** → **Credentials** → **Create credentials** → **OAuth client ID** → type **Web application**, name `MyAvedan review console`.
4. **Authorised JavaScript origins:**
   - `https://admin-staging.myavedan.in`
   - `https://admin.myavedan.in`
5. **Authorised redirect URIs:**
   - `https://admin-staging.myavedan.in/api/auth/callback/google`
   - `https://admin.myavedan.in/api/auth/callback/google`
6. **Create**, then copy the **Client ID** and **Client secret**.

### 2. Give the Worker its secrets (staging)
Run each in the project folder. Each command asks you to paste the value; never put these in chat, code or GitHub.

```
npx wrangler secret put BETTER_AUTH_SECRET --env staging    # a long random string (see below)
npx wrangler secret put GOOGLE_CLIENT_ID --env staging
npx wrangler secret put GOOGLE_CLIENT_SECRET --env staging
npx wrangler secret put ADMIN_EMAILS --env staging          # your Google email; several separated by commas
```

A random value for `BETTER_AUTH_SECRET`:

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Create the sign-in tables on staging
Deploys run migrations automatically. To do it by hand:

```
npx wrangler d1 migrations apply myavedan-staging --env staging --remote
```

### 4. Sign in
Open https://admin-staging.myavedan.in → **Continue with Google**. Your email from `ADMIN_EMAILS` becomes admin.

Repeat step 2 with `--env production` before production launch (use a different `BETTER_AUTH_SECRET`).

## Local development

```
npm run db:migrate:local
npm run db:seed:local
npm run dev:api          # builds the console, serves it at http://localhost:8787
npm run seed:review      # in a second terminal: two sample drafts to review
```

`apps/api/.dev.vars` (never committed) needs, besides the values in `.env.example`:

```
AUTH_DEV_LOGIN=true
ADMIN_EMAILS=admin@example.com
BETTER_AUTH_SECRET=<any long random string>
```

Then sign in on the console with `admin@example.com` and any 8+ character password; the first sign-in creates the account. Email-and-password sign-in only exists when `AUTH_DEV_LOGIN=true`, which is never set on staging or production.

## Optional: Cloudflare Access in front

The Worker can also require a Cloudflare Access token (`ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`) in addition to Google sign-in. It is off by default and not needed.
