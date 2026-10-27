// Command routes: issue, list, detail, cancel, and safety switches.

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import { issueCommand, listCommands, getCommand, cancelCommand, CommandError } from '../commands/service';
import { setSetting, getSetting } from '../core/settings';
import { prisma } from '../core/db';
import { COMMAND_TYPES } from '@voltlink/shared';

export const commandsRouter = Router();

commandsRouter.use(requireAuth);

const issueSchema = z.object({
  type: z.enum(COMMAND_TYPES as unknown as [string, ...string[]]),
  params: z.record(z.string(), z.unknown()).optional().default({}),
  idempotencyKey: z.string().max(120).optional(),
  stepUp: z.object({ password: z.string().optional(), totp: z.string().optional() }).optional(),
});

commandsRouter.post('/', async (req, res) => {
  const parsed = issueSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION', message: 'Valid command type required.' } });
    return;
  }
  const { vehicleId } = (req.body ?? {}) as { vehicleId?: string };
  if (!vehicleId) {
    res.status(400).json({ error: { code: 'VALIDATION', message: 'vehicleId is required.' } });
    return;
  }
  try {
    const command = await issueCommand(req.user!.id, req.user!.role, vehicleId, parsed.data.type as never, parsed.data.params as never, parsed.data, { ip: req.ip, requestId: (req as never as { id?: string }).id });
    res.status(201).json({ data: command });
  } catch (err) {
    if (err instanceof CommandError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message } });
      return;
    }
    throw err;
  }
});

commandsRouter.get('/', async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
  const vehicleId = typeof req.query.vehicleId === 'string' ? req.query.vehicleId : null;
  const result = await listCommands(req.user!.id, vehicleId, page, pageSize);
  res.json({ data: { items: result.items, page, pageSize, total: result.total } });
});

commandsRouter.get('/:id', async (req, res) => {
  try {
    const result = await getCommand(req.user!.id, req.params.id);
    res.json({ data: result });
  } catch (err) {
    if (err instanceof CommandError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message } });
      return;
    }
    throw err;
  }
});

commandsRouter.post('/:id/cancel', async (req, res) => {
  try {
    const command = await cancelCommand(req.user!.id, req.params.id);
    res.json({ data: command });
  } catch (err) {
    if (err instanceof CommandError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message } });
      return;
    }
    throw err;
  }
});

// ---- Safety switches (owner/admin only) ----

commandsRouter.get('/switches/status', async (req, res) => {
  const [globalReadOnly, commandsEnabled, providerCommandsEnabled, vehicleCommandsEnabled] = await Promise.all([
    getSetting('globalReadOnly'),
    getSetting('commandsEnabled'),
    getSetting('providerCommandsEnabled'),
    getSetting('vehicleCommandsEnabled'),
  ]);
  const vehicleSwitches = await prisma.vehicle.findMany({
    where: { ownerId: req.user!.id },
    select: { id: true, displayName: true },
  });
  const perVehicle = await Promise.all(
    vehicleSwitches.map(async (v) => ({ id: v.id, name: v.displayName, disabled: (await getSetting(`vehicleCmd:${v.id}`)) === 'false' })),
  );
  res.json({
    data: {
      globalReadOnly: globalReadOnly === 'true',
      commandsEnabled: commandsEnabled === 'true',
      providerCommandsEnabled: providerCommandsEnabled === 'true',
      vehicleCommandsEnabled: vehicleCommandsEnabled === 'true',
      perVehicle,
    },
  });
});

commandsRouter.post('/switches', async (req, res) => {
  const role = req.user!.role;
  if (!['OWNER', 'ADMIN'].includes(role)) {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Owner or admin required to change safety switches.' } });
    return;
  }
  const body = (req.body ?? {}) as { globalReadOnly?: boolean; commandsEnabled?: boolean; providerCommandsEnabled?: boolean; vehicleCommandsEnabled?: boolean };
  if (typeof body.globalReadOnly === 'boolean') await setSetting('globalReadOnly', String(body.globalReadOnly));
  if (typeof body.commandsEnabled === 'boolean') await setSetting('commandsEnabled', String(body.commandsEnabled));
  if (typeof body.providerCommandsEnabled === 'boolean') await setSetting('providerCommandsEnabled', String(body.providerCommandsEnabled));
  if (typeof body.vehicleCommandsEnabled === 'boolean') await setSetting('vehicleCommandsEnabled', String(body.vehicleCommandsEnabled));
  res.json({ data: { ok: true } });
});

commandsRouter.post('/switches/vehicle', async (req, res) => {
  const { vehicleId, disabled } = (req.body ?? {}) as { vehicleId?: string; disabled?: boolean };
  if (!vehicleId || typeof disabled !== 'boolean') {
    res.status(400).json({ error: { code: 'VALIDATION', message: 'vehicleId and disabled required.' } });
    return;
  }
  const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
  if (!vehicle || vehicle.ownerId !== req.user!.id) {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only the vehicle owner can change its switch.' } });
    return;
  }
  await setSetting(`vehicleCmd:${vehicleId}`, String(!disabled));
  res.json({ data: { ok: true } });
});
