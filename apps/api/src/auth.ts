/**
 * Sign-in for the review console (Better Auth), set up the way TrutiAI does it.
 * - "Continue with Google" when GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set.
 * - Email + password ONLY when AUTH_DEV_LOGIN=true (local testing without Google).
 * - Roles: reader | reviewer | admin. Admin is given at sign-up (and kept) for emails in ADMIN_EMAILS.
 *   Admins promote other accounts to reviewer from the console.
 * - Without BETTER_AUTH_SECRET sign-in is switched off rather than running on a public fallback secret.
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import type { Env } from "./env";
import { schema } from "./auth-schema";

export type Role = "reader" | "reviewer" | "admin";
export const ROLE_RANK: Record<Role, number> = { reader: 0, reviewer: 1, admin: 2 };

export function adminEmails(env: Env): string[] {
  return (env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export const isDevLogin = (env: Env) => env.AUTH_DEV_LOGIN === "true";
export const isGoogleConfigured = (env: Env) => Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
export const isAuthConfigured = (env: Env) => Boolean(env.BETTER_AUTH_SECRET) || isDevLogin(env);

function build(env: Env) {
  const baseURL = env.AUTH_URL ?? "http://localhost:8787";
  return betterAuth({
    appName: "MyAvedan",
    baseURL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET || "dev-only-secret-change-me-dev-only-secret-change-me",
    trustedOrigins: [baseURL, "http://localhost:8787", "http://127.0.0.1:8787", "http://localhost:4322"],
    database: drizzleAdapter(drizzle(env.DB, { schema }), { provider: "sqlite", schema }),
    socialProviders: isGoogleConfigured(env)
      ? { google: { clientId: env.GOOGLE_CLIENT_ID!, clientSecret: env.GOOGLE_CLIENT_SECRET!, prompt: "select_account" as const } }
      : {},
    emailAndPassword: { enabled: isDevLogin(env), requireEmailVerification: false },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    user: {
      additionalFields: {
        role: { type: "string", required: false, defaultValue: "reader", input: false },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (u) => {
            const role: Role = adminEmails(env).includes((u.email ?? "").toLowerCase()) ? "admin" : "reader";
            return { data: { ...u, role } };
          },
        },
      },
    },
    advanced: {
      cookiePrefix: "myavedan",
      useSecureCookies: baseURL.startsWith("https://"),
    },
  });
}

/**
 * Visitor sign-in on myavedan.in, served by this API on its own host (api.myavedan.in). Same Google app
 * and user table as the console, but its own cookies, shared across *.myavedan.in so the site can use
 * them. Visitors are 'reader' users: they never get console access.
 */
function buildSite(env: Env) {
  const baseURL = env.SITE_AUTH_URL ?? "http://127.0.0.1:8787";
  const secure = baseURL.startsWith("https://");
  const origins = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return betterAuth({
    appName: "MyAvedan",
    baseURL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET || "dev-only-secret-change-me-dev-only-secret-change-me",
    trustedOrigins: [baseURL, ...origins],
    database: drizzleAdapter(drizzle(env.DB, { schema }), { provider: "sqlite", schema }),
    socialProviders: isGoogleConfigured(env)
      ? { google: { clientId: env.GOOGLE_CLIENT_ID!, clientSecret: env.GOOGLE_CLIENT_SECRET!, prompt: "select_account" as const } }
      : {},
    emailAndPassword: { enabled: isDevLogin(env), requireEmailVerification: false },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24, cookieCache: { enabled: true, maxAge: 5 * 60 } },
    user: { additionalFields: { role: { type: "string", required: false, defaultValue: "reader", input: false } } },
    databaseHooks: {
      user: {
        create: {
          before: async (u) => ({ data: { ...u, role: adminEmails(env).includes((u.email ?? "").toLowerCase()) ? "admin" : "reader" } }),
        },
      },
    },
    advanced: {
      cookiePrefix: env.SITE_COOKIE_PREFIX ?? "myavedan_site",
      useSecureCookies: secure,
      ...(secure ? { crossSubDomainCookies: { enabled: true, domain: ".myavedan.in" } } : {}),
    },
  });
}

let cachedSite: { env: Env; auth: ReturnType<typeof buildSite> } | undefined;
export function siteAuth(env: Env) {
  if (!cachedSite || cachedSite.env !== env) cachedSite = { env, auth: buildSite(env) };
  return cachedSite.auth;
}

let cached: { env: Env; auth: ReturnType<typeof build> } | undefined;

/** One Better Auth instance per isolate (the env object is stable within an isolate). */
export function auth(env: Env) {
  if (!cached || cached.env !== env) cached = { env, auth: build(env) };
  return cached.auth;
}

export interface SignedInUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

/**
 * The signed-in user, with the role read fresh from the database: the session cookie caches it for up to
 * 5 minutes, and a demoted reviewer must lose access at once. Emails in ADMIN_EMAILS are kept as admin.
 */
export async function currentUser(request: Request, env: Env): Promise<SignedInUser | null> {
  if (!isAuthConfigured(env)) return null;
  const session = await auth(env).api.getSession({ headers: request.headers });
  if (!session?.user) return null;
  const row = await env.DB.prepare("SELECT id, email, name, role FROM user WHERE id = ?")
    .bind(session.user.id)
    .first<{ id: string; email: string; name: string; role: string }>();
  if (!row) return null;
  let role = (["reader", "reviewer", "admin"].includes(row.role) ? row.role : "reader") as Role;
  if (role !== "admin" && adminEmails(env).includes(row.email.toLowerCase())) {
    await env.DB.prepare("UPDATE user SET role = 'admin', updated_at = unixepoch() WHERE id = ?").bind(row.id).run();
    role = "admin";
  }
  return { id: row.id, email: row.email.toLowerCase(), name: row.name, role };
}

export function hasRole(u: { role: Role } | null, min: Role): boolean {
  return Boolean(u) && ROLE_RANK[u!.role] >= ROLE_RANK[min];
}
