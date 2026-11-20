import { useEffect, useState } from "preact/hooks";
import { ApiError, signIn } from "./api";

/** Shown when nobody is signed in, or the signed-in account is not a reviewer yet. */
export function SignIn({ notReviewer, onSignedIn }: { notReviewer: string | null; onSignedIn: () => void }) {
  const [opts, setOpts] = useState<{ configured: boolean; google: boolean; dev: boolean } | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    signIn.options().then(setOpts).catch(() => setOpts({ configured: false, google: false, dev: false }));
  }, []);

  async function dev(e: Event) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      try {
        await signIn.devSignIn(email, password);
      } catch {
        // First time on a fresh local database: create the account, then it is signed in.
        await signIn.devSignUp(email, password, email.split("@")[0] ?? "Reviewer");
      }
      onSignedIn();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await signIn.signOut().catch(() => undefined);
    location.reload();
  }

  return (
    <main class="mx-auto max-w-md px-4 py-16">
      <div class="card grid gap-4 p-6">
        <div>
          <h1 class="text-2xl">Review console</h1>
          <p class="mt-1 text-sm text-ink-2">For MyAvedan reviewers only. Every action you take is recorded with your email.</p>
        </div>

        {notReviewer ? (
          <>
            <p class="notice notice-warn">{notReviewer}</p>
            <button type="button" class="btn justify-center" onClick={signOut}>
              Sign out and use another account
            </button>
          </>
        ) : !opts ? (
          <p class="text-ink-3">Loading…</p>
        ) : !opts.configured ? (
          <p class="notice notice-warn">Sign-in is not set up on this server yet. See docs/REVIEW_CONSOLE.md.</p>
        ) : (
          <>
            {opts.google && (
              <button type="button" class="btn btn-primary justify-center py-2.5" onClick={() => signIn.google().catch((e) => setErr(e.message))}>
                <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                  <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
                  <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
                  <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
                  <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
                </svg>
                Continue with Google
              </button>
            )}
            {opts.dev && (
              <form class="grid gap-2 border-t border-line pt-4" onSubmit={dev}>
                <p class="text-xs text-ink-3">Local development sign-in (switched off on staging and production).</p>
                <input class="field" type="email" required placeholder="Email" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} aria-label="Email" />
                <input
                  class="field"
                  type="password"
                  required
                  minLength={8}
                  placeholder="Password (8+ characters)"
                  value={password}
                  onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
                  aria-label="Password"
                />
                <button class="btn justify-center" type="submit" disabled={busy}>
                  {busy ? "Signing in…" : "Sign in"}
                </button>
              </form>
            )}
            {!opts.google && !opts.dev && <p class="notice notice-warn">No sign-in method is enabled. Add the Google keys (docs/REVIEW_CONSOLE.md).</p>}
          </>
        )}
        {err && (
          <p class="text-sm text-bad" role="alert">
            {err}
          </p>
        )}
      </div>
    </main>
  );
}
