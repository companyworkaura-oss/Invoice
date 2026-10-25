/**
 * Sniffs a file's actual byte content against the magic-number
 * signature of each allowed raster format — never trusts the
 * client-supplied Content-Type/filename alone, which is trivially
 * spoofable (e.g. an SVG renamed to logo.png with Content-Type:
 * image/png). SVG is deliberately not in this list at all: it's a
 * markup format that can carry a <script> or an onload= handler, so
 * accepting it (sanitized or not — this app has no SVG sanitizer)
 * would reopen the exact stored-XSS risk this check exists to close.
 * See F01.
 */
const SIGNATURES: { extension: string; mimeType: string; matches: (buf: Buffer) => boolean }[] = [
  {
    extension: 'png',
    mimeType: 'image/png',
    matches: (buf) => buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    extension: 'jpg',
    mimeType: 'image/jpeg',
    matches: (buf) => buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff,
  },
  {
    extension: 'webp',
    mimeType: 'image/webp',
    matches: (buf) =>
      buf.length >= 12 &&
      buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buf.subarray(8, 12).toString('ascii') === 'WEBP',
  },
];

/**
 * Returns the detected {extension, mimeType} when the buffer's actual
 * leading bytes match one of the allowed raster formats, or null when
 * it matches none of them — including a well-formed SVG/XML, a
 * renamed non-image file, or any other spoofed upload.
 */
export function detectImageSignature(buffer: Buffer): { extension: string; mimeType: string } | null {
  const match = SIGNATURES.find((sig) => sig.matches(buffer));
  return match ? { extension: match.extension, mimeType: match.mimeType } : null;
}
