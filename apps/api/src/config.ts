function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}

export const config = {
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
};
