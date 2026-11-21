# Publishing

**Production is the default** (since 21 Nov 2026): the reader sends to `api.myavedan.in`, reviewers work at `admin.myavedan.in`, and approvals publish `myavedan.in`. Staging (`*-staging.myavedan.in`) stays for testing changes. With no approved notices, production builds the real site with an honest "first verified notices are being added" message; it never uses sample data. Live since 21 Nov 2026.

How an approved notice reaches the public site.

```
reviewer approves ──► publish_queue ──► API (cron every 30 min, or at once if urgent)
                                          │  repository_dispatch "publish"
                                          ▼
                     GitHub Actions: Publish workflow
                       1. download approved notices (GET /api/snapshot, token)
                       2. validate them with the site's schema
                       3. build the site + search index
                       4. deploy to Cloudflare
                       5. POST /api/publish/complete  → notices marked published
```

- **Regular approvals** go out at the next cron run, at most once every 30 minutes on staging (120 on production).
- **Urgent approvals** (the Urgent box in the review console) start a rebuild immediately. Use it for date changes and deadline extensions.
- **Publish now** on the console's queue page starts a rebuild for anything waiting.
- **Nightly rebuild** at 00:30 IST keeps "closing soon" lists and statuses fresh even on quiet days.
- **Code deploys** (merges to `main`) also build from the approved notices, so a code change never brings old data back.
- If GitHub refuses a request (for example an expired token), nothing is lost: the notices stay waiting and the next run tries again.
- A build that fails leaves the previous site live.

**Staging and sample data:** until the first real notice is approved on staging, builds keep the sample notices from `data/snapshot.json` so the staging site is never empty. Production never builds from sample data; it stops with an error instead.

## Secrets

| Where | Name | What it is |
| --- | --- | --- |
| Cloudflare Worker (staging) | `PUBLISH_TOKEN` | Password for downloading approved notices. Already set. |
| GitHub → Actions secrets | `STAGING_PUBLISH_TOKEN` | **The same value** as the Worker's `PUBLISH_TOKEN`. |
| Cloudflare Worker (staging) | `GITHUB_DISPATCH_TOKEN` | GitHub token that lets the API start the Publish workflow. |
| Cloudflare Worker (production) | `PUBLISH_TOKEN`, `INGEST_HMAC_SECRET`, `BETTER_AUTH_SECRET`, `IP_HASH_SALT` | Set 21 Nov 2026. |
| Cloudflare Worker (production) | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ADMIN_EMAILS`, `GITHUB_DISPATCH_TOKEN` | Set by the owner (`--env production`). |
| GitHub → Actions secrets | `PRODUCTION_PUBLISH_TOKEN`, `PRODUCTION_INGEST_SECRET` | The same values as the production Worker's `PUBLISH_TOKEN` and `INGEST_HMAC_SECRET`. |

### Create `GITHUB_DISPATCH_TOKEN`
1. GitHub → your profile picture → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
2. Name `myavedan-publish-trigger`, expiry up to 1 year (note the date).
3. **Repository access:** Only select repositories → `myavedan`.
4. **Repository permissions:** **Contents → Read and write** (this is the permission GitHub requires to start a workflow by `repository_dispatch`). Nothing else.
5. **Generate token**, copy it, and in the `apps/api` folder run:

   ```
   npx wrangler secret put GITHUB_DISPATCH_TOKEN --env staging
   ```

For production later: `PRODUCTION_PUBLISH_TOKEN` in GitHub, `PUBLISH_TOKEN` and `GITHUB_DISPATCH_TOKEN` with `--env production`.
