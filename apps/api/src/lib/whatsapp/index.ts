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
  if (override) return override;
  if (!instance) {
    const { phoneNumberId, accessToken, apiVersion } = config.whatsappBusiness;
    instance =
      phoneNumberId && accessToken
        ? new BusinessCloudApiWhatsAppService({ phoneNumberId, accessToken, apiVersion })
        : new ClickToChatWhatsAppService();
  }
  return instance;
}

let override: WhatsAppService | undefined;

/**
 * Test-only seam (F03): ESM named exports are read-only bindings, so a
 * test can't just reassign `getWhatsAppService` itself to stub which
 * service is active — this is the one sanctioned way to do that,
 * letting a test prove "GET never sends, even with Business Cloud API
 * configured" against the real route/service code, without needing a
 * second process started with different environment variables (which
 * `config`'s one-time, import-time env read would otherwise require).
 * Call with `undefined` to restore the normal env-driven selection.
 */
export function setWhatsAppServiceForTesting(service: WhatsAppService | undefined): void {
  override = service;
}
