import { useCallback, useEffect, useState } from "react";

import { beginSignIn, consumeCallback, signOut, storedToken, CLIENT_ID } from "./lib/auth";
import { GitHubClient, GitHubError } from "./lib/github";
import { loadCollection, type Collection, type WritePlan } from "./lib/collection";
import { BrowseView } from "./views/Browse";
import { SearchView } from "./views/Search";
import { AddView } from "./views/Add";
import { EditView } from "./views/Edit";
import { IngestView } from "./views/Ingest";
import { ValidateView } from "./views/Validate";
import { TagsView } from "./views/Tags";

const TABS = ["Browse", "Search", "Add", "Edit", "Ingest", "Validate", "Tags"] as const;
export type Tab = (typeof TABS)[number];

/** What every view needs: the loaded collection, and a way to write to it. */
export interface ViewProps {
  collection: Collection;
  client: GitHubClient;
  commit: (plan: WritePlan) => Promise<void>;
  busy: boolean;
  goTo: (tab: Tab) => void;
}

export function App() {
  const [token, setToken] = useState<string | null>(() => storedToken());
  const [collection, setCollection] = useState<Collection | null>(null);
  const [tab, setTab] = useState<Tab>("Search");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A sign-in redirect comes back with the result in the URL fragment.
  useEffect(() => {
    const result = consumeCallback();
    if (!result) return;
    if (result.error) setError(result.error);
    if (result.token) setToken(result.token);
  }, []);

  const client = token ? new GitHubClient(token) : null;

  const load = useCallback(async () => {
    if (!client) return;
    setBusy(true);
    setError(null);
    try {
      setCollection(await loadCollection(client));
    } catch (problem) {
      setError(describe(problem));
      if (problem instanceof GitHubError && problem.status === 401) {
        signOut();
        setToken(null);
      }
    } finally {
      setBusy(false);
    }
    // client is derived from token; rebuilding it every render would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const commit = useCallback(
    async (plan: WritePlan) => {
      if (!client || !collection) return;
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        // The expected head makes this a compare-and-swap: if the desktop (or another
        // device) committed since this page loaded, the write is refused rather than
        // built on stale content.
        await client.commit(plan.files, plan.message, collection.headSha);
        setNotice(`${plan.message} — committed ${plan.files.length} file(s)`);
        await load();
      } catch (problem) {
        setError(describe(problem));
      } finally {
        setBusy(false);
      }
    },
    [client, collection, load],
  );

  if (!token) return <SignIn error={error} />;

  const props: ViewProps | null = collection
    ? { collection, client: client as GitHubClient, commit, busy, goTo: setTab }
    : null;

  return (
    <>
      <header className="topbar">
        <h1>LinkSource</h1>
        {busy && <span className="small muted">working…</span>}
        <button
          onClick={() => {
            signOut();
            setToken(null);
            setCollection(null);
          }}
        >
          Sign out
        </button>
      </header>

      {error && <div className="banner error">{error}</div>}
      {notice && <div className="banner ok">{notice}</div>}

      {!props && !error && <p className="muted">Loading the collection…</p>}

      {props && (
        <main>
          {tab === "Browse" && <BrowseView {...props} />}
          {tab === "Search" && <SearchView {...props} />}
          {tab === "Add" && <AddView {...props} />}
          {tab === "Edit" && <EditView {...props} />}
          {tab === "Ingest" && <IngestView {...props} />}
          {tab === "Validate" && <ValidateView {...props} />}
          {tab === "Tags" && <TagsView {...props} />}
        </main>
      )}

      <nav className="tabs">
        {TABS.map((name) => (
          <button key={name} aria-current={tab === name} onClick={() => setTab(name)}>
            {name}
          </button>
        ))}
      </nav>
    </>
  );
}

function SignIn({ error }: { error: string | null }) {
  return (
    <main style={{ paddingTop: 60 }}>
      <h1>LinkSource</h1>
      <p className="muted">
        Manage the collection from any device. Signing in with GitHub grants write access to
        public repositories only.
      </p>

      {error && <div className="banner error">{error}</div>}

      {!CLIENT_ID && (
        <div className="banner warn">
          <code>VITE_GITHUB_CLIENT_ID</code> is not set, so sign-in cannot start. Create an
          OAuth App on GitHub, then add its client id to the Pages project environment (and
          to <code>web/.env.local</code> for local development).
        </div>
      )}

      <button className="primary" disabled={!CLIENT_ID} onClick={() => beginSignIn()}>
        Sign in with GitHub
      </button>
    </main>
  );
}

function describe(problem: unknown): string {
  if (problem instanceof GitHubError) return `GitHub: ${problem.message}`;
  if (problem instanceof Error) return problem.message;
  return String(problem);
}
