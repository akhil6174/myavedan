import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import "./styles.css";
import { api, ApiError } from "./api";
import { Queue } from "./Queue";
import { Review } from "./Review";
import { Corrections } from "./Corrections";

type Route = { name: "queue" } | { name: "review"; id: string } | { name: "corrections" };

function parse(hash: string): Route {
  const m = hash.match(/^#\/review\/([\w-]+)/);
  if (m) return { name: "review", id: m[1]! };
  if (hash.startsWith("#/corrections")) return { name: "corrections" };
  return { name: "queue" };
}

function App() {
  const [route, setRoute] = useState<Route>(parse(location.hash));
  const [me, setMe] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const on = () => setRoute(parse(location.hash));
    addEventListener("hashchange", on);
    api
      .me()
      .then((r) => setMe(r.email))
      .catch((e) => setAuthError(e instanceof ApiError ? e.message : "Could not reach the API."));
    return () => removeEventListener("hashchange", on);
  }, []);

  const nav = (href: string, label: string, active: boolean) => (
    <a
      href={href}
      aria-current={active ? "page" : undefined}
      class={`rounded-lg px-3 py-1.5 text-sm font-medium no-underline ${active ? "bg-brand-soft text-brand-ink" : "text-ink-2 hover:bg-sunk"}`}
    >
      {label}
    </a>
  );

  return (
    <div class="min-h-screen">
      <header class="border-b border-line bg-surface">
        <div class="mx-auto flex max-w-[96rem] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5">
          <a href="#/queue" class="flex items-center gap-2 text-ink no-underline">
            <img src="/favicon.svg" width="26" height="26" alt="" />
            <span class="font-display text-lg font-extrabold" style="font-stretch:85%">
              MyAvedan <span class="font-sans text-sm font-medium text-ink-3">review console</span>
            </span>
          </a>
          <nav class="flex gap-1" aria-label="Console">
            {nav("#/queue", "Queue", route.name !== "corrections")}
            {nav("#/corrections", "Error reports", route.name === "corrections")}
          </nav>
          <span class="ml-auto text-xs text-ink-3">{me ? `Signed in as ${me}` : ""}</span>
        </div>
      </header>
      {authError ? (
        <main class="mx-auto max-w-2xl px-4 py-12">
          <h1 class="text-2xl">You are not signed in</h1>
          <p class="mt-2 text-ink-2">{authError}</p>
          <p class="mt-2 text-sm text-ink-3">
            The review console is only available to reviewers through Cloudflare Access. Reload the page to sign in again.
          </p>
        </main>
      ) : !me ? (
        <p class="px-4 py-12 text-center text-ink-3">Loading…</p>
      ) : route.name === "review" ? (
        <Review id={route.id} />
      ) : route.name === "corrections" ? (
        <Corrections />
      ) : (
        <Queue />
      )}
    </div>
  );
}

render(<App />, document.getElementById("app")!);
