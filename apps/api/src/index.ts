import { mkdir } from 'node:fs/promises';
import { createApp } from './app.js';
import { config } from './config.js';
import { migrate } from './db/migrate.js';

await mkdir(config.uploadsDir, { recursive: true });
await migrate();
createApp().listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}`);
});
