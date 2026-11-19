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
  /** Cloudflare Access team domain, e.g. myavedan.cloudflareaccess.com. */
  ACCESS_TEAM_DOMAIN?: string;
  /** Cloudflare Access application audience tag. */
  ACCESS_AUD?: string;
  /** Optional comma-separated reviewer emails allowed in addition to the Access policy. */
  ADMIN_EMAILS?: string;
  /** Local development only: reviewer email accepted from localhost when Access is not configured. */
  ADMIN_DEV_EMAIL?: string;
}
