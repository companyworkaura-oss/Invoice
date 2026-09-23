import type { WhatsAppSharePayload } from '@invoice/shared';

export type { WhatsAppSharePayload } from '@invoice/shared';

/**
 * Service abstraction for sharing invoices over WhatsApp. V1 only needs
 * a free "click-to-chat" wa.me link (see ClickToChatWhatsAppService) —
 * swapping in WhatsApp Business Cloud API later (server-side send, PDF
 * as a media attachment, delivery receipts, ...) only means adding a
 * new class here and changing getWhatsAppService() — invoice code never
 * calls a provider directly, only this interface.
 */
export interface WhatsAppShareRequest {
  /** Customer's saved WhatsApp number, in whatever format it was stored. */
  toPhone: string;
  message: string;
}

export interface WhatsAppService {
  buildShare(request: WhatsAppShareRequest): Promise<WhatsAppSharePayload>;
}
