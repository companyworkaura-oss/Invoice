import type { ApiErrorBody } from '@invoice/shared';
import { ApiError } from './api';

const PDF_MAGIC = '%PDF-';

/**
 * The one PDF-download implementation this app uses — invoice and
 * statement downloads both call this instead of each rolling their own.
 * fetch() + arrayBuffer() (not .blob()) so the byte count and the
 * %PDF- magic bytes can be checked before anything is handed to the
 * browser to save — a 200 response with the right headers but a body
 * that never actually arrived (or arrived truncated) is exactly the
 * "downloads but says the PDF is empty" failure mode this guards
 * against, and it fails loudly here instead of producing a 0-byte or
 * corrupt file for the user to discover after opening it.
 *
 * The object URL is revoked after a delay, not immediately after
 * link.click() — revoking synchronously races the browser's own
 * (asynchronous) read of the blob and is a known source of a download
 * silently failing ("Failed - No file") even though the bytes were
 * fine.
 */
export async function downloadPdf(url: string, filename: string): Promise<void> {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Could not generate the PDF' }));
    throw new ApiError(res.status, body as ApiErrorBody);
  }

  const bytes = await res.arrayBuffer();
  if (bytes.byteLength === 0) {
    throw new ApiError(res.status, { error: 'The generated PDF was empty — please try again.' });
  }
  const header = String.fromCharCode(...new Uint8Array(bytes.slice(0, PDF_MAGIC.length)));
  if (header !== PDF_MAGIC) {
    throw new ApiError(res.status, { error: 'The server did not return a valid PDF file.' });
  }

  const blob = new Blob([bytes], { type: 'application/pdf' });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
}
