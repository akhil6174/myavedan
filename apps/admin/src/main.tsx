import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import "./styles.css";
import { api, ApiError, signIn, type Role } from "./api";
import { Queue } from "./Queue";
import { Review } from "./Review";
import { Corrections } from "./Corrections";
import { Reviewers } from "./Reviewers";
import { Links } from "./Links";
import { Health } from "./Health";
import { SignIn } from "./SignIn";

type Route = { name: "queue" } | { name: "review"; id: string } | { name: "corrections" } | { name: "reviewers" } | { name: "links" } | { name: "health" };

function parse(hash: string): Route {
  const m = hash.match(/^#\/review\/([\w-]+)/);
  if (m) return { name: "review", id: m[1]! };
  if (hash.startsWith("#/corrections")) return { name: "corrections" };
  if (hash.startsWith("#/reviewers")) return { name: "reviewers" };
  if (hash.startsWith("#/links")) return { name: "links" };
  if (hash.startsWith("#/health")) return { name: "health" };
  return { name: "queue" };
}

type Who = { state: "loading" } | { state: "signed-out" } | { state: "not-reviewer"; message: string } | { state: "in"; email: string; role: Role } | { state: "down"; message: string };

function App() {
  const [route, setRoute] = useState<Route>(parse(location.hash));
  const [who, setWho] = useState<Who>({ state: "loading" });

  const check = () =>
    api
      .me()
      .then((r) => setWho({ state: "in", email: r.email, role: r.role }))
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) setWho({ state: "signed-out" });
        else if (e instanceof ApiError && e.status === 403) setWho({ state: "not-reviewer", message: e.message });
        else setWho({ state: "down", message: "Could not reach the API. Check your connection and reload." });
      });

  useEffect(() => {
    const on = () => setRoute(parse(location.hash));
    addEventListener("hashchange", on);
    void check();
    return () => removeEventListener("hashchange", on);
  }, []);

  async function signOut() {
    await signIn.signOut().catch(() => undefined);
    setWho({ state: "signed-out" });
  }

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
          {who.state === "in" && (
            <nav class="flex gap-1" aria-label="Console">
              {nav("#/queue", "Queue", route.name === "queue" || route.name === "review")}
              {nav("#/links", "Official links", route.name === "links")}
              {nav("#/health", "Reader health", route.name === "health")}
              {nav("#/corrections", "Error reports", route.name === "corrections")}
              {who.role === "admin" && nav("#/reviewers", "Reviewers", route.name === "reviewers")}
            </nav>
          )}
          {who.state === "in" && (
            <span class="ml-auto flex items-center gap-3 text-xs text-ink-3">
              {who.email} · {who.role}
              <button type="button" class="btn btn-sm" onClick={signOut}>
                Sign out
              </button>
            </span>
          )}
        </div>
      </header>
      {who.state === "loading" ? (
        <p class="px-4 py-12 text-center text-ink-3">Loading…</p>
      ) : who.state === "down" ? (
        <p class="notice notice-warn mx-auto mt-10 max-w-xl">{who.message}</p>
      ) : who.state === "signed-out" || who.state === "not-reviewer" ? (
        <SignIn notReviewer={who.state === "not-reviewer" ? who.message : null} onSignedIn={() => void check()} />
      ) : route.name === "review" ? (
        <Review id={route.id} />
      ) : route.name === "links" ? (
        <Links />
      ) : route.name === "health" ? (
        <Health />
      ) : route.name === "corrections" ? (
        <Corrections />
      ) : route.name === "reviewers" && who.role === "admin" ? (
        <Reviewers me={who.email} />
      ) : (
        <Queue />
      )}
    </div>
  );
}

render(<App />, document.getElementById("app")!);
