import { config } from '../../../config.js';

/**
 * Fetches a company's logo and inlines it as a data: URI. A headless
 * page has no session cookie and no reliable base URL for relative
 * <img src>, so the logo has to be embedded rather than linked.
 * Storage-agnostic on purpose: works whether logoUrl is a path served
 * by this same process (LocalLogoStorage today) or, later, an absolute
 * URL from a cloud storage backend — no filesystem assumptions here.
 * Never throws: a logo that can't be fetched just means the PDF renders
 * without one, not that PDF generation fails.
 */
export async function fetchLogoDataUri(logoUrl: string | null): Promise<string | null> {
  if (!logoUrl) return null;
  const url = /^https?:\/\//.test(logoUrl) ? logoUrl : `http://127.0.0.1:${config.port}${logoUrl}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || 'image/png';
    const buffer = Buffer.from(await res.arrayBuffer());
    return `data:${contentType};base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  }
}
