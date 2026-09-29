import { config } from '../../config.js';
import { BusinessCloudApiWhatsAppService } from './business-cloud-api-whatsapp-service.js';
import { ClickToChatWhatsAppService } from './click-to-chat-whatsapp-service.js';
import type { WhatsAppService } from './whatsapp-service.js';

export type { WhatsAppService, WhatsAppShareRequest, WhatsAppSharePayload } from './whatsapp-service.js';

let instance: WhatsAppService | undefined;

/**
 * Single place that decides which WhatsAppService backend is active.
 * WhatsApp Business Cloud API only activates when all three of
 * WHATSAPP_PHONE_NUMBER_ID/WHATSAPP_ACCESS_TOKEN/WHATSAPP_API_VERSION
 * are configured (the first two have no default — see config.ts);
 * otherwise this falls back to the free click-to-chat link.
 */
export function getWhatsAppService(): WhatsAppService {
  if (!instance) {
    const { phoneNumberId, accessToken, apiVersion } = config.whatsappBusiness;
    instance =
      phoneNumberId && accessToken
        ? new BusinessCloudApiWhatsAppService({ phoneNumberId, accessToken, apiVersion })
        : new ClickToChatWhatsAppService();
  }
  return instance;
}
