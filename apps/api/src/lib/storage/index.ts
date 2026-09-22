import { config } from '../../config.js';
import { LocalLogoStorage } from './local-logo-storage.js';
import type { LogoStorage } from './logo-storage.js';

export type { LogoStorage, StoredFile } from './logo-storage.js';

let instance: LogoStorage | undefined;

/** Single place that decides which LogoStorage backend is active. */
export function getLogoStorage(): LogoStorage {
  instance ??= new LocalLogoStorage(config.uploadsDir, '/uploads');
  return instance;
}
