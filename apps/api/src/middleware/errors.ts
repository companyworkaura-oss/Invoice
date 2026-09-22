import type { NextFunction, Request, Response } from 'express';
import { MulterError } from 'multer';
import { HttpError } from '../lib/http-error.js';

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found' });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }
  // express.json() parse failures
  if (err && typeof err === 'object' && 'type' in err && err.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Invalid JSON' });
    return;
  }
  if (err instanceof MulterError) {
    res.status(400).json({ error: 'Invalid file upload', details: { logo: err.message } });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
}

/**
 * CSRF guard: state-changing requests must be JSON or a file upload.
 * Browsers cannot send a cross-site application/json request without a CORS
 * preflight, which we never allow. multipart/form-data *can* be sent
 * cross-site without a preflight, so it's only safe here because the
 * session cookie is SameSite=Lax and is never attached to a cross-site POST.
 */
export function requireJsonForMutations(req: Request, res: Response, next: NextFunction): void {
  const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  const hasBody = req.headers['content-length'] !== undefined && req.headers['content-length'] !== '0';
  if (mutating && hasBody && !req.is('application/json') && !req.is('multipart/form-data')) {
    res.status(415).json({ error: 'Content-Type must be application/json' });
    return;
  }
  next();
}
