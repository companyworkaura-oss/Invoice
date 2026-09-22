import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { LogoStorage, StoredFile } from './logo-storage.js';

/** Saves logos under <uploadsDir>/logos/<companyId>/ and serves them at <publicPath>/logos/... */
export class LocalLogoStorage implements LogoStorage {
  constructor(
    private uploadsDir: string,
    private publicPath: string,
  ) {}

  async save(companyId: string, file: StoredFile): Promise<string> {
    const dir = path.join(this.uploadsDir, 'logos', companyId);
    await mkdir(dir, { recursive: true });
    const filename = `${randomUUID()}.${file.extension}`;
    await writeFile(path.join(dir, filename), file.buffer);
    return `${this.publicPath}/logos/${companyId}/${filename}`;
  }

  async delete(url: string): Promise<void> {
    if (!url.startsWith(`${this.publicPath}/`)) return; // not one of ours (or already a cloud URL)
    const relative = url.slice(this.publicPath.length);
    await rm(path.join(this.uploadsDir, relative), { force: true });
  }
}
