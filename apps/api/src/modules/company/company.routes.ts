import { Router } from 'express';
import multer from 'multer';
import { config } from '../../config.js';
import { badRequest } from '../../lib/http-error.js';
import { getLogoStorage } from '../../lib/storage/index.js';
import { asBody, optionalEmail, optionalString } from '../../lib/validate.js';
import { auth, requireAuth, requireRole } from '../../middleware/auth.js';
import * as service from './company.service.js';

export const companyRouter = Router();
companyRouter.use(requireAuth);

const LOGO_MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxLogoBytes },
  fileFilter: (_req, file, cb) => {
    cb(null, file.mimetype in LOGO_MIME_TO_EXT);
  },
});

// The tenant is always the session's company; there is no :companyId in the URL.
companyRouter.get('/', async (req, res) => {
  res.json(await service.getCompany(auth(req).companyId));
});

companyRouter.patch('/', requireRole('owner', 'admin'), async (req, res) => {
  const body = asBody(req.body);
  const defaultCurrency = optionalString(body, 'defaultCurrency', { min: 3, max: 3 })?.toUpperCase();
  if (defaultCurrency && !/^[A-Z]{3}$/.test(defaultCurrency)) {
    throw badRequest('Validation failed', { defaultCurrency: 'Must be a 3-letter ISO code' });
  }

  const patch: service.CompanyProfilePatch = {
    name: optionalString(body, 'name'),
    defaultCurrency,
    factoryName: optionalString(body, 'factoryName', { max: 200 }),
    ownerName: optionalString(body, 'ownerName', { max: 200 }),
    phone: optionalString(body, 'phone', { max: 40 }),
    whatsapp: optionalString(body, 'whatsapp', { max: 40 }),
    email: optionalEmail(body, 'email'),
    address: optionalString(body, 'address', { max: 500 }),
    taxNumber: optionalString(body, 'taxNumber', { max: 100 }),
    invoicePrefix: optionalString(body, 'invoicePrefix', { max: 20 }),
    defaultInvoiceTemplate: optionalString(body, 'defaultInvoiceTemplate', { max: 100 }),
    invoiceTerms: optionalString(body, 'invoiceTerms', { max: 5000 }),
  };
  res.json(await service.updateCompany(auth(req).companyId, patch));
});

companyRouter.post('/logo', requireRole('owner', 'admin'), upload.single('logo'), async (req, res) => {
  if (!req.file) {
    throw badRequest('Validation failed', { logo: 'Attach an image (png, jpg, webp, or svg) under 2MB' });
  }
  const { companyId } = auth(req);
  const extension = LOGO_MIME_TO_EXT[req.file.mimetype];
  const storage = getLogoStorage();

  const previousUrl = await service.getLogoUrl(companyId);
  const newUrl = await storage.save(companyId, { buffer: req.file.buffer, extension });
  const company = await service.setLogoUrl(companyId, newUrl);
  if (previousUrl) await storage.delete(previousUrl).catch(() => undefined);

  res.status(201).json(company);
});
