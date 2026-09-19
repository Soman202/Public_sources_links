/** Cloudflare Pages Function: the one server-side step in the whole app.
 *
 *  GitHub's OAuth token exchange needs the client secret, and a secret cannot live in a
 *  static page. That is the only reason this file exists -- everything else runs in the
 *  browser against the GitHub API directly.
 *
 *  Flow:
 *    1. the page redirects to github.com/login/oauth/authorize with a random `state`
 *    2. GitHub redirects back here with `code` and that `state`
 *    3. this function swaps `code` + CLIENT_SECRET for an access token
 *    4. it redirects to the app with the token in the URL *fragment*
 *
 *  The fragment matters: fragments are never sent to a server, so the token stays out of
 *  access logs, Referer headers and any proxy in between. The page reads it, checks the
 *  state it stored before step 1, and clears the URL.
 *
 *  Environment (Pages project settings):
 *    GITHUB_CLIENT_ID      - public, also built into the page as VITE_GITHUB_CLIENT_ID
 *    GITHUB_CLIENT_SECRET  - secret
 */

interface Env {
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
}

interface PagesContext {
  request: Request;
  env: Env;
}

export const onRequestGet = async (context: PagesContext): Promise<Response> => {
  const url = new URL(context.request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";

  // GitHub reports a user who declined here rather than sending a code.
  const denied = url.searchParams.get("error");
  if (denied) {
    return redirectToApp(url, { error: url.searchParams.get("error_description") ?? denied, state });
  }

  if (!code) {
    return redirectToApp(url, { error: "no authorization code in the callback", state });
  }

  const { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET } = context.env;
  if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
    return redirectToApp(url, {
      error: "the Pages project is missing GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET",
      state,
    });
  }

  let payload: { access_token?: string; error_description?: string; error?: string };
  try {
    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
      }),
    });
    payload = await response.json();
  } catch (error) {
    return redirectToApp(url, {
      error: `could not reach GitHub to exchange the code: ${String(error)}`,
      state,
    });
  }

  if (!payload.access_token) {
    return redirectToApp(url, {
      error: payload.error_description ?? payload.error ?? "GitHub returned no access token",
      state,
    });
  }

  return redirectToApp(url, { token: payload.access_token, state });
};

/** Send the browser back to the app root, carrying the result in the fragment. */
function redirectToApp(url: URL, params: Record<string, string>): Response {
  const fragment = new URLSearchParams(params).toString();
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${url.origin}/#${fragment}`,
      // A token in a redirect is not something to keep anywhere.
      "Cache-Control": "no-store",
    },
  });
}
