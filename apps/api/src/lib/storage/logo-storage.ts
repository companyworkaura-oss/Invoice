/**
 * Storage abstraction for company logos. Swapping local disk for cloud
 * storage (S3, GCS, ...) later only means adding a new class here and
 * changing getLogoStorage() — nothing above this layer changes.
 */
export interface StoredFile {
  buffer: Buffer;
  extension: string; // without the leading dot, e.g. "png"
}

export interface LogoStorage {
  /** Saves a logo for a company and returns a URL the frontend can load. */
  save(companyId: string, file: StoredFile): Promise<string>;
  /** Best-effort delete of a previously saved logo, by the URL save() returned. */
  delete(url: string): Promise<void>;
}
