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
};
