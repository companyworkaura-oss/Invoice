import { Router } from 'express';
import { clearSessionCookie, setSessionCookie } from '../../lib/cookies.js';
import { asBody, requireEmail, requireString } from '../../lib/validate.js';
import { auth, requireAuth } from '../../middleware/auth.js';
import * as service from './auth.service.js';

export const authRouter = Router();

authRouter.post('/register', async (req, res) => {
  const body = asBody(req.body);
  const session = await service.register({
    companyName: requireString(body, 'companyName'),
    fullName: requireString(body, 'fullName'),
    email: requireEmail(body),
    password: requireString(body, 'password', { min: 8, max: 128 }),
  });
  setSessionCookie(res, session.token, session.expiresAt);
  res.status(201).json({ ok: true });
});

authRouter.post('/login', async (req, res) => {
  const body = asBody(req.body);
  const session = await service.login(requireEmail(body), requireString(body, 'password', { max: 128 }));
  setSessionCookie(res, session.token, session.expiresAt);
  res.json({ ok: true });
});

authRouter.post('/logout', requireAuth, async (req, res) => {
  await service.logout(auth(req).sessionId);
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const { userId, companyId } = auth(req);
  res.json(await service.getMe(userId, companyId));
});
