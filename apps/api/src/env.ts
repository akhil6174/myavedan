export interface Env {
  DB: D1Database;
  /** Review console files (apps/admin/dist), served on the admin host. */
  ASSETS?: Fetcher;
  /** Comma-separated browser origins allowed to call public routes. */
  ALLOWED_ORIGINS?: string;
  /** Hostname that serves the review console, e.g. admin-staging.myavedan.in. */
  ADMIN_HOST?: string;
  /** Shared secret for HMAC-signed pipeline requests. */
  INGEST_HMAC_SECRET?: string;
  /** Bearer token for the publish workflow reading the approved snapshot. */
  PUBLISH_TOKEN?: string;
  /** Salt for hashing client IPs used only for abuse limits. */
  IP_HASH_SALT?: string;

  // ---- publishing ----
  /** "owner/repo" whose Publish workflow rebuilds the site. */
  GITHUB_REPO?: string;
  /** Fine-grained GitHub token allowed to send repository_dispatch to GITHUB_REPO. */
  GITHUB_DISPATCH_TOKEN?: string;
  /** Which environment the Publish workflow should rebuild: staging | production. */
  PUBLISH_ENV?: string;
  /** Minimum minutes between regular publishes (urgent approvals skip it). */
  PUBLISH_MIN_INTERVAL_MINUTES?: string;

  // ---- sign-in (Better Auth, as on TrutiAI) ----
  /** Public URL of the review console, e.g. https://admin-staging.myavedan.in. */
  AUTH_URL?: string;
  /** Public URL of this API for visitor sign-in on the site, e.g. https://api.myavedan.in. */
  SITE_AUTH_URL?: string;
  /** Cookie name prefix for visitor sessions (different per environment). */
  SITE_COOKIE_PREFIX?: string;
  /** Random secret that signs sessions. Required outside local development. */
  BETTER_AUTH_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Comma-separated emails that become admin when they sign in. */
  ADMIN_EMAILS?: string;
  /** "true" only in local development: allows email + password sign-in. */
  AUTH_DEV_LOGIN?: string;

  // ---- optional: Cloudflare Access in front of the console (not used by default) ----
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
}
