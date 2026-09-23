import { ClickToChatWhatsAppService } from './click-to-chat-whatsapp-service.js';
import type { WhatsAppService } from './whatsapp-service.js';

export type { WhatsAppService, WhatsAppShareRequest, WhatsAppSharePayload } from './whatsapp-service.js';

let instance: WhatsAppService | undefined;

/** Single place that decides which WhatsAppService backend is active. */
export function getWhatsAppService(): WhatsAppService {
  instance ??= new ClickToChatWhatsAppService();
  return instance;
}
