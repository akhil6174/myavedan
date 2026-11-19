export interface Env {
  DB: D1Database;
  /** Comma-separated browser origins allowed to call public routes. */
  ALLOWED_ORIGINS?: string;
  /** Shared secret for HMAC-signed pipeline requests. */
  INGEST_HMAC_SECRET?: string;
  /** Bearer token for the publish workflow reading the approved snapshot. */
  PUBLISH_TOKEN?: string;
  /** Salt for hashing client IPs used only for abuse limits. */
  IP_HASH_SALT?: string;
}
