import type { WhatsAppService, WhatsAppShareRequest, WhatsAppSharePayload } from './whatsapp-service.js';

/** Default implementation: no WhatsApp Business account, API key, or paid tier required. */
export class ClickToChatWhatsAppService implements WhatsAppService {
  readonly requiresPdfAttachment = false;

  async buildShare(request: WhatsAppShareRequest): Promise<WhatsAppSharePayload> {
    return {
      mode: 'click-to-chat',
      url: request.fallbackUrl,
      toPhone: request.toPhone,
      message: request.message,
    };
  }
}
