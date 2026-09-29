import type { WhatsAppService, WhatsAppShareRequest, WhatsAppSharePayload } from './whatsapp-service.js';

export interface WhatsAppBusinessCloudConfig {
  phoneNumberId: string;
  accessToken: string;
  apiVersion: string;
}

/**
 * Optional production integration: sends the invoice PDF as an actual
 * WhatsApp document message via the WhatsApp Business Cloud API
 * (Meta's Graph API), instead of the click-to-chat link this app falls
 * back to when it isn't configured (see getWhatsAppService in
 * index.ts). Two calls per share: upload the PDF as media, then send a
 * document message referencing that media id.
 *
 * Never throws — a failed send is reported back as
 * `{ status: 'failed', error }` alongside the same click-to-chat
 * fallback link every payload carries, so the frontend always has a
 * manual path even when the automatic one fails.
 */
export class BusinessCloudApiWhatsAppService implements WhatsAppService {
  readonly requiresPdfAttachment = true;

  constructor(private readonly cfg: WhatsAppBusinessCloudConfig) {}

  async buildShare(request: WhatsAppShareRequest): Promise<WhatsAppSharePayload> {
    const base = {
      mode: 'business-api' as const,
      url: request.fallbackUrl,
      toPhone: request.toPhone,
      message: request.message,
    };

    if (!request.pdf) {
      return { ...base, status: 'failed', error: 'No invoice PDF was generated to send.' };
    }

    try {
      const mediaId = await this.uploadMedia(request.pdf);
      await this.sendDocumentMessage(request.toPhone, mediaId, request.pdf.filename, request.invoiceNumber);
      return { ...base, status: 'sent' };
    } catch (err) {
      return { ...base, status: 'failed', error: err instanceof Error ? err.message : 'WhatsApp send failed' };
    }
  }

  private graphUrl(path: string): string {
    return `https://graph.facebook.com/${this.cfg.apiVersion}/${path}`;
  }

  private async uploadMedia(pdf: { buffer: Buffer; filename: string }): Promise<string> {
    const form = new FormData();
    form.set('messaging_product', 'whatsapp');
    form.set('file', new Blob([new Uint8Array(pdf.buffer)], { type: 'application/pdf' }), pdf.filename);

    const res = await fetch(this.graphUrl(`${this.cfg.phoneNumberId}/media`), {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.cfg.accessToken}` },
      body: form,
    });
    if (!res.ok) {
      throw new Error(`WhatsApp media upload failed (HTTP ${res.status})`);
    }
    const body = (await res.json()) as { id?: string };
    if (!body.id) {
      throw new Error('WhatsApp media upload did not return a media id');
    }
    return body.id;
  }

  private async sendDocumentMessage(toPhone: string, mediaId: string, filename: string, caption: string): Promise<void> {
    const res = await fetch(this.graphUrl(`${this.cfg.phoneNumberId}/messages`), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.cfg.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: toPhone,
        type: 'document',
        document: { id: mediaId, filename, caption },
      }),
    });
    if (!res.ok) {
      throw new Error(`WhatsApp document send failed (HTTP ${res.status})`);
    }
  }
}
