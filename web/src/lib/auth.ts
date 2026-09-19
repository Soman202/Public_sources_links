/** GitHub OAuth from the browser side.
 *
 *  The client id is public and built into the page. The secret lives only in the Pages
 *  Function at /api/oauth. The token comes back in the URL fragment, is checked against a
 *  `state` this module generated, and is then kept in localStorage so the installed PWA
 *  stays signed in between launches on a phone.
 *
 *  That storage is the honest tradeoff of a static app: the token is a real credential on
 *  that device, scoped to `public_repo`. `signOut` clears it. If it ever needs to be
 *  tighter, the Function can set an httpOnly cookie and proxy the API instead -- at the
 *  cost of becoming a full proxy.
 */

const TOKEN_KEY = "linksource.token";
const STATE_KEY = "linksource.oauth-state";

export const CLIENT_ID = import.meta.env.VITE_GITHUB_CLIENT_ID as string | undefined;

/** Only what the app needs: write access to public repositories. */
const SCOPE = "public_repo";

export function storedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    // Private windows and blocked site data both throw rather than return null.
    return null;
  }
}

export function storeToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Not fatal -- the session still works, it just will not survive a reload.
  }
}

export function signOut(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* nothing to clear */
  }
}

/** Send the browser to GitHub's consent screen. */
export function beginSignIn(): void {
  if (!CLIENT_ID) {
    throw new Error(
      "VITE_GITHUB_CLIENT_ID is not set. Create an OAuth App, then add it to the Pages " +
        "project's environment (and to web/.env.local for local development).",
    );
  }

  const state = randomState();
  try {
    sessionStorage.setItem(STATE_KEY, state);
  } catch {
    // Without stored state the callback cannot be verified, so refuse rather than
    // complete a flow that cannot be checked.
    throw new Error("session storage is unavailable, so the sign-in cannot be verified");
  }

  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", CLIENT_ID);
  authorize.searchParams.set("scope", SCOPE);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("redirect_uri", `${location.origin}/api/oauth`);

  location.assign(authorize.toString());
}

export interface CallbackResult {
  token?: string;
  error?: string;
}

/** Read the fragment the Pages Function redirected back with, verify it, and clear it.
 *  Returns null when this is an ordinary page load rather than a callback. */
export function consumeCallback(): CallbackResult | null {
  const fragment = location.hash.startsWith("#") ? location.hash.slice(1) : "";
  if (!fragment) return null;

  const params = new URLSearchParams(fragment);
  const token = params.get("token");
  const error = params.get("error");
  if (!token && !error) return null;

  const returned = params.get("state") ?? "";
  let expected: string | null = null;
  try {
    expected = sessionStorage.getItem(STATE_KEY);
    sessionStorage.removeItem(STATE_KEY);
  } catch {
    /* handled below */
  }

  // Always clear the fragment, whatever the outcome, so a token cannot be left in the URL
  // bar or in history.
  history.replaceState(null, "", location.pathname + location.search);

  if (error) return { error };

  if (!expected || returned !== expected) {
    return { error: "the sign-in could not be verified (state mismatch) -- try again" };
  }

  if (token) storeToken(token);
  return { token: token ?? undefined };
}

function randomState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
