import type { WhatsAppSharePayload } from '@invoice/shared';

export type { WhatsAppSharePayload } from '@invoice/shared';

/**
 * Service abstraction for sharing invoices over WhatsApp. The free
 * "click-to-chat" wa.me link (ClickToChatWhatsAppService) is always
 * available; WhatsApp Business Cloud API (BusinessCloudApiWhatsAppService)
 * is an optional swap-in that actually sends the PDF as a document
 * message — invoice code never talks to a provider directly, only this
 * interface (see getWhatsAppService in index.ts for which one is active).
 */
export interface WhatsAppShareRequest {
  /** Already normalized (digits-only, international) and validated by the caller. */
  toPhone: string;
  message: string;
  invoiceNumber: string;
  /** A manual click-to-chat link, built regardless of which service is active — every payload carries a usable fallback. */
  fallbackUrl: string;
  /** Only generated when the active service actually needs the bytes (see requiresPdfAttachment) — click-to-chat never does; the browser downloads the PDF itself. */
  pdf?: { buffer: Buffer; filename: string };
}

export interface WhatsAppService {
  /** True only for a service that can attach/send the PDF itself (Business Cloud API) — tells the caller whether it's worth generating the PDF bytes server-side before calling buildShare. */
  readonly requiresPdfAttachment: boolean;
  buildShare(request: WhatsAppShareRequest): Promise<WhatsAppSharePayload>;
}
