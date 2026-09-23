import { Router } from 'express';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES, type AuditAction, type AuditEntityType } from '@invoice/shared';
import { badRequest } from '../../lib/http-error.js';
import { optionalDate } from '../../lib/validate.js';
import { auth, requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permissions.js';
import * as service from './audit.service.js';

export const auditRouter = Router();
auditRouter.use(requireAuth);

auditRouter.get('/', requirePermission('audit.view'), async (req, res) => {
  const actionRaw = typeof req.query.action === 'string' ? req.query.action : undefined;
  if (actionRaw && !(AUDIT_ACTIONS as readonly string[]).includes(actionRaw)) {
    throw badRequest('Validation failed', { action: `Must be one of: ${AUDIT_ACTIONS.join(', ')}` });
  }

  const entityTypeRaw = typeof req.query.entityType === 'string' ? req.query.entityType : undefined;
  if (entityTypeRaw && !(AUDIT_ENTITY_TYPES as readonly string[]).includes(entityTypeRaw)) {
    throw badRequest('Validation failed', { entityType: `Must be one of: ${AUDIT_ENTITY_TYPES.join(', ')}` });
  }

  const from = optionalDate({ from: req.query.from }, 'from');
  const to = optionalDate({ to: req.query.to }, 'to');

  const logs = await service.listAuditLogs(auth(req).companyId, {
    action: actionRaw as AuditAction | undefined,
    entityType: entityTypeRaw as AuditEntityType | undefined,
    from,
    to,
  });
  res.json(logs);
});
