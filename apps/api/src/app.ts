import express from 'express';
import { config } from './config.js';
import { errorHandler, notFoundHandler, requireJsonForMutations } from './middleware/errors.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { companiesRouter } from './modules/company/companies.routes.js';
import { companyRouter } from './modules/company/company.routes.js';
import { customersRouter } from './modules/customers/customer.routes.js';
import { dashboardRouter } from './modules/dashboard/dashboard.routes.js';
import { categoriesRouter } from './modules/formulas/category.routes.js';
import { invoicesRouter } from './modules/invoices/invoice.routes.js';
import { ledgerRouter } from './modules/ledger/ledger.routes.js';
import { paymentsRouter } from './modules/payments/payment.routes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  // Uploaded logos (local storage backend); served read-only, no directory listing.
  app.use('/uploads', express.static(config.uploadsDir, { index: false }));
  app.use(express.json({ limit: '100kb' }));
  app.use('/api', requireJsonForMutations);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.use('/api/auth', authRouter);
  app.use('/api/company', companyRouter);
  app.use('/api/companies', companiesRouter);
  app.use('/api/customers/:customerId/ledger', ledgerRouter);
  app.use('/api/customers', customersRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/categories', categoriesRouter);
  app.use('/api/invoices', invoicesRouter);
  app.use('/api/payments', paymentsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
