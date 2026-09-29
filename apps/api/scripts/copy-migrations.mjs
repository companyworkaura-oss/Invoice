// Cross-platform replacement for `cp -r src/migrations dist/` — cp isn't
// a recognized command on Windows (only Linux/macOS ship it), so the
// build broke there. fs.cpSync is a Node builtin (no extra dependency)
// and behaves the same on every platform the app actually runs on.
import { cpSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const apiRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = path.join(apiRoot, 'src', 'migrations');
const dest = path.join(apiRoot, 'dist', 'migrations');

cpSync(src, dest, { recursive: true });
