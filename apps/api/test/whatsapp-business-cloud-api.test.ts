import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BusinessCloudApiWhatsAppService } from '../src/lib/whatsapp/business-cloud-api-whatsapp-service.js';
import { ClickToChatWhatsAppService } from '../src/lib/whatsapp/click-to-chat-whatsapp-service.js';

// Unit-level tests for the WhatsAppService implementations, with a
// stubbed global.fetch for the Business Cloud API one — there's no real
// WhatsApp Business account in this dev/test environment, so these
// verify the request shapes and the sent/failed contract, not an actual
// delivery. See whatsapp.test.ts for the end-to-end click-to-chat flow
// this app actually runs with by default (no credentials configured).

const baseRequest = {
  toPhone: '923001234567',
  message: 'Hello from a test',
  invoiceNumber: 'INV-000001',
  fallbackUrl: 'https://wa.me/923001234567?text=Hello',
};

function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const original = globalThis.fetch;
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

test('ClickToChatWhatsAppService never needs a PDF and just wraps the fallback URL', async () => {
  const service = new ClickToChatWhatsAppService();
  assert.equal(service.requiresPdfAttachment, false);

  const share = await service.buildShare({ ...baseRequest, pdf: undefined });
  assert.deepEqual(share, {
    mode: 'click-to-chat',
    url: baseRequest.fallbackUrl,
    toPhone: baseRequest.toPhone,
    message: baseRequest.message,
  });
});

test('BusinessCloudApiWhatsAppService requires a PDF attachment', () => {
  const service = new BusinessCloudApiWhatsAppService({
    phoneNumberId: '1234567890',
    accessToken: 'test-token',
    apiVersion: 'v21.0',
  });
  assert.equal(service.requiresPdfAttachment, true);
});

test('BusinessCloudApiWhatsAppService uploads the PDF then sends a document message, reporting status: sent', async () => {
  const service = new BusinessCloudApiWhatsAppService({
    phoneNumberId: '1234567890',
    accessToken: 'test-token',
    apiVersion: 'v21.0',
  });

  const stub = stubFetch((url) => {
    if (url.endsWith('/1234567890/media')) {
      return new Response(JSON.stringify({ id: 'media-abc-123' }), { status: 200 });
    }
    if (url.endsWith('/1234567890/messages')) {
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.abc' }] }), { status: 200 });
    }
    throw new Error(`Unexpected fetch to ${url}`);
  });

  try {
    const share = await service.buildShare({
      ...baseRequest,
      pdf: { buffer: Buffer.from('%PDF-1.4 fake pdf bytes'), filename: 'INV-000001-Customer.pdf' },
    });

    assert.equal(share.mode, 'business-api');
    assert.equal(share.status, 'sent');
    assert.equal(share.url, baseRequest.fallbackUrl); // manual fallback always present, even on success
    assert.equal(share.toPhone, baseRequest.toPhone);

    // Request shapes: media upload first, then the document message referencing that media id.
    assert.equal(stub.calls.length, 2);
    assert.match(stub.calls[0].url, /\/v21\.0\/1234567890\/media$/);
    assert.equal((stub.calls[0].init.headers as Record<string, string>).Authorization, 'Bearer test-token');

    assert.match(stub.calls[1].url, /\/v21\.0\/1234567890\/messages$/);
    const sentBody = JSON.parse(stub.calls[1].init.body as string);
    assert.equal(sentBody.messaging_product, 'whatsapp');
    assert.equal(sentBody.to, baseRequest.toPhone);
    assert.equal(sentBody.type, 'document');
    assert.equal(sentBody.document.id, 'media-abc-123');
    assert.equal(sentBody.document.filename, 'INV-000001-Customer.pdf');
    assert.equal(sentBody.document.caption, baseRequest.invoiceNumber);
  } finally {
    stub.restore();
  }
});

test('BusinessCloudApiWhatsAppService reports status: failed (never throws) when the upload fails', async () => {
  const service = new BusinessCloudApiWhatsAppService({
    phoneNumberId: '1234567890',
    accessToken: 'test-token',
    apiVersion: 'v21.0',
  });

  const stub = stubFetch(() => new Response('server error', { status: 500 }));

  try {
    const share = await service.buildShare({
      ...baseRequest,
      pdf: { buffer: Buffer.from('%PDF-1.4 fake pdf bytes'), filename: 'INV-000001-Customer.pdf' },
    });

    assert.equal(share.mode, 'business-api');
    assert.equal(share.status, 'failed');
    assert.ok(share.error);
    // A failed send still carries the manual fallback link — the frontend always has something to do.
    assert.equal(share.url, baseRequest.fallbackUrl);
  } finally {
    stub.restore();
  }
});

test('BusinessCloudApiWhatsAppService reports status: failed when no PDF was generated', async () => {
  const service = new BusinessCloudApiWhatsAppService({
    phoneNumberId: '1234567890',
    accessToken: 'test-token',
    apiVersion: 'v21.0',
  });

  const share = await service.buildShare({ ...baseRequest, pdf: undefined });
  assert.equal(share.status, 'failed');
  assert.equal(share.error, 'No invoice PDF was generated to send.');
});

test('buildPublicPdfUrl omits localhost/127.0.0.1 base URLs and builds a real link for a public HTTPS base', async () => {
  const { buildPublicPdfUrl } = await import('../src/modules/invoices/whatsapp-share.service.js');

  assert.equal(buildPublicPdfUrl(undefined, 'inv-1'), undefined);
  assert.equal(buildPublicPdfUrl('http://localhost:4000', 'inv-1'), undefined);
  assert.equal(buildPublicPdfUrl('http://127.0.0.1:4000', 'inv-1'), undefined);
  assert.equal(
    buildPublicPdfUrl('https://invoices.example.com', 'inv-1'),
    'https://invoices.example.com/api/invoices/inv-1/pdf',
  );
  // trailing slash on the base doesn't produce a double slash
  assert.equal(
    buildPublicPdfUrl('https://invoices.example.com/', 'inv-1'),
    'https://invoices.example.com/api/invoices/inv-1/pdf',
  );
});
