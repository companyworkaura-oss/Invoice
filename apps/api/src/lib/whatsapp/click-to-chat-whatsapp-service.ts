import { buildWhatsAppClickToChatUrl } from '@invoice/shared';
import type { WhatsAppService, WhatsAppShareRequest, WhatsAppSharePayload } from './whatsapp-service.js';

/** V1 implementation: no WhatsApp Business account, API key, or paid tier required. */
export class ClickToChatWhatsAppService implements WhatsAppService {
  async buildShare(request: WhatsAppShareRequest): Promise<WhatsAppSharePayload> {
    return {
      mode: 'click-to-chat',
      url: buildWhatsAppClickToChatUrl(request.toPhone, request.message),
      toPhone: request.toPhone,
      message: request.message,
    };
  }
}
