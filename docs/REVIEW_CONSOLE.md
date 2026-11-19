# Review console

Where a person checks every critical fact in a notice against the official PDF before it goes live.

- Staging: https://admin-staging.myavedan.in
- Production: https://admin.myavedan.in

The console is served by the API Worker on its own hostname. The admin API answers only on that hostname, and only for a signed-in reviewer.

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

## One-time setup: Cloudflare Access (account owner)

Until this is done, the console page loads but the API refuses every request outside local development.

1. Cloudflare dashboard → **Zero Trust**. The first time, choose a team name (for example `myavedan`) and the **Free** plan (up to 50 users).
2. **Access** → **Applications** → **Add an application** → **Self-hosted**.
   - Name: `MyAvedan review console (staging)`
   - Domain: `admin-staging.myavedan.in`
   - Session duration: 24 hours
3. **Policy:** Action **Allow**, rule **Emails** → the reviewers' email addresses.
4. Login method: **One-time PIN** (email code) works with no extra setup. Google sign-in can be added later.
5. Save, then open the application's **Overview** and copy the **Application Audience (AUD) Tag**.
6. Give the Worker the two values (run in the project folder):

   ```
   npx wrangler secret put ACCESS_TEAM_DOMAIN --env staging    # e.g. myavedan.cloudflareaccess.com
   npx wrangler secret put ACCESS_AUD --env staging            # the AUD tag
   ```

   Optional second gate, the same emails as the policy, comma-separated:

   ```
   npx wrangler secret put ADMIN_EMAILS --env staging
   ```

Repeat with `admin.myavedan.in` and `--env production` before production launch.

## Local development

```
npm run db:migrate:local
npm run db:seed:local
npm run dev:api          # builds the console, serves it at http://localhost:8787
npm run seed:review      # in a second terminal: two sample drafts to review
```

`apps/api/.dev.vars` needs `ADMIN_DEV_EMAIL=you@localhost` (plus the secrets in `.env.example`). The local login only works from localhost and only when Access is not configured.
