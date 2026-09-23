function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}

const nodeEnv = process.env.NODE_ENV ?? 'development';
const isProduction = nodeEnv === 'production';
const isTest = nodeEnv === 'test';

export const config = {
  nodeEnv,
  isProduction,
  isTest,
  databaseUrl: required('DATABASE_URL'),
  port: Number(process.env.PORT ?? 4000),
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS ?? 168),
  uploadsDir: process.env.UPLOADS_DIR ?? 'uploads',
  maxLogoBytes: Number(process.env.MAX_LOGO_BYTES ?? 2 * 1024 * 1024),
  // playwright-core ships no browser of its own — point it at one already
  // installed on the host (see deployment notes in pdf.service.ts).
  chromiumExecutablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  // Off only in the test env (.env.test) — the test suite legitimately
  // registers/logs in far more than a real client would in the same
  // window. Rate limiting itself is covered by a standalone test that
  // mounts the same middleware on its own throwaway app instead — see
  // middleware/rate-limit.ts and test/security.test.ts.
  rateLimitDisabled: process.env.RATE_LIMIT_DISABLED === 'true',
  // Off by default: this API can run standalone (frontend deployed
  // separately, e.g. to a static host/CDN) or serve apps/web/dist itself
  // for a single-process deployment — see DEPLOYMENT.md. Explicit opt-in,
  // not "serve it if the directory happens to exist", so this never
  // changes behavior based on incidental local build state (e.g. in
  // tests, which build/clean apps/web/dist independently of the API).
  serveFrontend: process.env.SERVE_FRONTEND === 'true',
  webDistDir: process.env.WEB_DIST_DIR ?? '../web/dist',
};

// A production process running with an insecure session cookie would
// send the session token over plain HTTP — loud and early beats a
// silent, hard-to-notice misconfiguration in a real deployment.
if (config.isProduction && !config.cookieSecure) {
  console.warn(
    'WARNING: NODE_ENV=production but COOKIE_SECURE is not "true" — ' +
      'the session cookie will be sent over plain HTTP. Set COOKIE_SECURE=true ' +
      'once this app is served over HTTPS (see DEPLOYMENT.md).',
  );
}
