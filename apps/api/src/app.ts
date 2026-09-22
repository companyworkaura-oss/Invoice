import express from 'express';
import { errorHandler, notFoundHandler, requireJsonForMutations } from './middleware/errors.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { companiesRouter } from './modules/company/companies.routes.js';
import { companyRouter } from './modules/company/company.routes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '100kb' }));
  app.use('/api', requireJsonForMutations);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.use('/api/auth', authRouter);
  app.use('/api/company', companyRouter);
  app.use('/api/companies', companiesRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
