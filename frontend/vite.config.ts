import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig(({ mode }) => {
  const environment = { ...loadEnv(mode, repositoryRoot, ['VITE_', 'OIDC_ORIGIN']), ...process.env };
  const requireOidc = environment.VITE_REQUIRE_OIDC === 'true';
  if (requireOidc && (!environment.VITE_OIDC_AUTHORITY || !environment.VITE_OIDC_CLIENT_ID)) {
    throw new Error('Set VITE_OIDC_AUTHORITY and VITE_OIDC_CLIENT_ID before building the production frontend.');
  }
  if (requireOidc) {
    let authority: URL;
    try {
      authority = new URL(environment.VITE_OIDC_AUTHORITY ?? '');
    } catch {
      throw new Error('VITE_OIDC_AUTHORITY must be a valid HTTPS URL.');
    }
    if (authority.protocol !== 'https:') {
      throw new Error('VITE_OIDC_AUTHORITY must use HTTPS in production.');
    }
    let oidcOrigin: URL;
    try {
      oidcOrigin = new URL(environment.OIDC_ORIGIN ?? '');
    } catch {
      throw new Error('Set OIDC_ORIGIN to the OIDC authority origin before building the production frontend.');
    }
    if (oidcOrigin.protocol !== 'https:' || oidcOrigin.origin !== environment.OIDC_ORIGIN
      || oidcOrigin.origin !== authority.origin) {
      throw new Error('OIDC_ORIGIN must be the exact HTTPS origin of VITE_OIDC_AUTHORITY.');
    }
  }

  return {
    envDir: repositoryRoot,
    plugins: [vue()],
    server: {
      host: process.env.VITE_DEV_HOST ?? '127.0.0.1',
      port: Number(process.env.VITE_DEV_PORT ?? 5173),
      strictPort: true,
      watch: process.env.VITE_FILE_WATCH_POLLING === 'true'
        ? { usePolling: true, interval: 1_000 }
        : undefined,
      proxy: {
        '/api': process.env.API_PROXY_TARGET ?? 'http://localhost:3000',
      },
    },
  };
});
