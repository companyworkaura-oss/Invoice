import { mkdir } from 'node:fs/promises';
import { createApp } from './app.js';
import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { pool } from './db/pool.js';

await mkdir(config.uploadsDir, { recursive: true });
await migrate();
const server = createApp().listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port} (env: ${config.nodeEnv})`);
});

// Container orchestrators (Docker, k8s, ...) send SIGTERM before killing
// a process on deploy/scale-down — stop accepting new connections, let
// in-flight requests finish, close the DB pool, then exit. Without this
// a rolling deploy can cut off in-flight requests mid-transaction.
let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down gracefully`);
  server.close(async (err) => {
    if (err) console.error('Error while closing HTTP server:', err);
    await pool.end().catch((poolErr) => console.error('Error while closing DB pool:', poolErr));
    process.exit(err ? 1 : 0);
  });
  // Don't hang forever if a connection never drains.
  setTimeout(() => {
    console.error('Forced shutdown after 10s timeout');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
