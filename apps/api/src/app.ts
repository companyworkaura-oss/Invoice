import path from 'node:path';
import { existsSync } from 'node:fs';
import express from 'express';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { errorHandler, notFoundHandler, requireJsonForMutations } from './middleware/errors.js';
import { requestLogging } from './middleware/logging.js';
import { auditRouter } from './modules/audit/audit.routes.js';
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
  app.use(requestLogging);
  // Uploaded logos (local storage backend); served read-only, no directory listing.
  app.use('/uploads', express.static(config.uploadsDir, { index: false }));
  app.use(express.json({ limit: '100kb' }));
  app.use('/api', requireJsonForMutations);

  // Liveness: "is the process up" — no DB round trip, so a load
  // balancer/orchestrator can poll this frequently and cheaply.
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });
  // Readiness: "can this instance actually serve traffic" — a real DB
  // round trip, so a slow/unreachable database takes this instance out
  // of rotation instead of it accepting requests it can't fulfil.
  app.get('/api/health/ready', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false, error: 'Database unavailable' });
    }
  });

  app.use('/api/auth', authRouter);
  app.use('/api/audit-logs', auditRouter);
  app.use('/api/company', companyRouter);
  app.use('/api/companies', companiesRouter);
  app.use('/api/customers/:customerId/ledger', ledgerRouter);
  app.use('/api/customers', customersRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/categories', categoriesRouter);
  app.use('/api/invoices', invoicesRouter);
  app.use('/api/payments', paymentsRouter);

  // Single-process deployment option: this API can also serve the built
  // frontend (apps/web/dist), rather than requiring it be hosted
  // separately — off unless explicitly enabled (see config.ts). Mounted
  // after every /api and /uploads route, so those always win; anything
  // left over falls through to index.html (this app has no client-side
  // routes to preserve, just one page with internal tab state).
  if (config.serveFrontend) {
    const webDistDir = path.resolve(process.cwd(), config.webDistDir);
    const indexHtml = path.join(webDistDir, 'index.html');
    if (existsSync(indexHtml)) {
      app.use(express.static(webDistDir, { index: false }));
      app.use((req, res, next) => {
        if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
        res.sendFile(indexHtml);
      });
    } else {
      console.warn(`WARNING: SERVE_FRONTEND=true but ${indexHtml} does not exist — run "npm run build" first.`);
    }
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
