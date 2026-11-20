import { useEffect, useState } from "preact/hooks";
import { api, type Role, type UserRow } from "./api";

const ROLE_HELP: Record<Role, string> = {
  reader: "No console access",
  reviewer: "Can review and publish notices",
  admin: "Reviewer, and manages who can review",
};

/** Admins only: everyone who has signed in, and their role. */
export function Reviewers({ me }: { me: string }) {
  const [items, setItems] = useState<UserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.users().then((r) => setItems(r.items)).catch((e) => setError(e.message));
  useEffect(() => void load(), []);

  async function change(u: UserRow, role: Role) {
    setError(null);
    try {
      await api.setRole(u.id, role);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <main class="mx-auto max-w-4xl px-4 py-8">
      <h1 class="text-3xl">Reviewers</h1>
      <p class="mt-1 max-w-2xl text-ink-2">
        Anyone can sign in with Google, but only reviewers and admins can open the queue. Ask a new reviewer to sign in once, then
        change their role here. Removing access signs them out straight away.
      </p>
      {error && <p class="notice notice-warn mt-4">{error}</p>}
      {!items && !error && <p class="mt-6 text-ink-3">Loading…</p>}
      {items && (
        <div class="table-wrap mt-6">
          <table>
            <thead>
              <tr>
                <th>Person</th>
                <th>Role</th>
              </tr>
            </thead>
            <tbody>
              {items.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div class="font-medium">{u.name}</div>
                    <div class="text-sm text-ink-3">{u.email}</div>
                  </td>
                  <td>
                    <label class="sr-only" for={`role-${u.id}`}>
                      Role for {u.email}
                    </label>
                    <select
                      id={`role-${u.id}`}
                      class="field w-auto py-1.5"
                      value={u.role}
                      disabled={u.email === me}
                      onChange={(e) => change(u, (e.target as HTMLSelectElement).value as Role)}
                    >
                      <option value="reader">Reader</option>
                      <option value="reviewer">Reviewer</option>
                      <option value="admin">Admin</option>
                    </select>
                    <div class="mt-1 text-xs text-ink-3">{u.email === me ? "This is you" : ROLE_HELP[u.role]}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
