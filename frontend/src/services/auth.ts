import { UserManager, WebStorageStateStore } from 'oidc-client-ts';

const { VITE_OIDC_AUTHORITY, VITE_OIDC_CLIENT_ID, VITE_OIDC_SCOPE } = import.meta.env;

export const authEnabled = Boolean(VITE_OIDC_AUTHORITY && VITE_OIDC_CLIENT_ID);

if (import.meta.env.PROD && !authEnabled) {
  throw new Error('Production authentication settings are missing from the frontend build.');
}

export const userManager = authEnabled
  ? new UserManager({
      authority: VITE_OIDC_AUTHORITY,
      client_id: VITE_OIDC_CLIENT_ID,
      redirect_uri: `${window.location.origin}/auth/callback`,
      post_logout_redirect_uri: window.location.origin,
      response_type: 'code',
      scope: VITE_OIDC_SCOPE || 'openid agent:read agent:triage',
      userStore: new WebStorageStateStore({ store: window.sessionStorage }),
      automaticSilentRenew: false,
      monitorSession: false,
    })
  : null;

export async function requireAccessToken(): Promise<string | undefined> {
  if (!userManager) return undefined;
  const user = await userManager.getUser();
  if (!user || user.expired || !user.access_token) {
    await userManager.signinRedirect();
    throw new Error('Перенаправляємо на сторінку входу…');
  }
  return user.access_token;
}

export async function completeSignIn(): Promise<void> {
  if (!userManager) return;
  if (window.location.pathname === '/auth/callback') {
    await userManager.signinRedirectCallback();
    window.history.replaceState({}, document.title, '/');
  }
}

export async function signOut(): Promise<void> {
  if (userManager) await userManager.signoutRedirect();
}
