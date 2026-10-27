// Automation routes: CRUD, dry run, manual trigger, execution history.

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../core/db';
import { requireAuth } from '../auth/middleware';
import { dispatchTrigger, runAutomation } from '../automations/engine';
import { ACTION_TYPES, CONDITION_TYPES, TRIGGER_TYPES } from '@voltlink/shared';

export const automationsRouter = Router();

automationsRouter.use(requireAuth);

const specSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  enabled: z.boolean().optional().default(true),
  vehicleId: z.string().nullable().optional(),
  trigger: z.object({ type: z.enum(TRIGGER_TYPES as unknown as [string, ...string[]]), params: z.record(z.string(), z.unknown()).optional().default({}) }),
  conditions: z.array(z.object({ type: z.enum(CONDITION_TYPES as unknown as [string, ...string[]]), params: z.record(z.string(), z.unknown()).optional().default({}) })).max(20).optional().default([]),
  actions: z.array(z.object({ type: z.enum(ACTION_TYPES as unknown as [string, ...string[]]), params: z.record(z.string(), z.unknown()).optional().default({}) })).min(1).max(10),
  cooldownSec: z.number().int().min(0).max(86400).optional().default(0),
  maxRetries: z.number().int().min(0).max(5).optional().default(1),
});

automationsRouter.get('/', async (req, res) => {
  const rows = await prisma.automation.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' } });
  res.json({
    data: rows.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description ?? undefined,
      enabled: a.enabled,
      vehicleId: a.vehicleId,
      trigger: { type: a.triggerType, params: a.triggerParams ?? {} },
      conditions: (a.conditions ?? []) as unknown[],
      actions: (a.actions ?? []) as unknown[],
      cooldownSec: a.cooldownSec,
      maxRetries: a.maxRetries,
      lastRunAt: a.lastRunAt?.toISOString(),
      lastResult: a.lastResult ?? undefined,
      runCount: a.runCount,
      failureCount: a.failureCount,
      createdAt: a.createdAt.toISOString(),
    })),
  });
});

automationsRouter.post('/', async (req, res) => {
  const parsed = specSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION', message: 'Invalid automation definition.', details: parsed.error.flatten() } });
    return;
  }
  const d = parsed.data;
  if (d.vehicleId) {
    const vehicle = await prisma.vehicle.findUnique({ where: { id: d.vehicleId } });
    if (!vehicle || vehicle.ownerId !== req.user!.id) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Vehicle not found.' } });
      return;
    }
  }
  const a = await prisma.automation.create({
    data: {
      userId: req.user!.id,
      name: d.name,
      description: d.description,
      enabled: d.enabled,
      vehicleId: d.vehicleId ?? null,
      triggerType: d.trigger.type,
      triggerParams: JSON.parse(JSON.stringify(d.trigger.params ?? {})),
      conditions: JSON.parse(JSON.stringify(d.conditions)),
      actions: JSON.parse(JSON.stringify(d.actions)),
      cooldownSec: d.cooldownSec,
      maxRetries: d.maxRetries,
    },
  });
  res.status(201).json({ data: { id: a.id } });
});

automationsRouter.patch('/:id', async (req, res) => {
  const row = await prisma.automation.findUnique({ where: { id: req.params.id } });
  if (!row || row.userId !== req.user!.id) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Automation not found.' } });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  if (typeof body.enabled === 'boolean') data.enabled = body.enabled;
  if (typeof body.name === 'string') data.name = body.name.slice(0, 80);
  if (typeof body.cooldownSec === 'number') data.cooldownSec = Math.min(86400, body.cooldownSec);
  if (typeof body.description === 'string') data.description = body.description.slice(0, 500);
  await prisma.automation.update({ where: { id: row.id }, data });
  res.json({ data: { ok: true } });
});

automationsRouter.delete('/:id', async (req, res) => {
  const row = await prisma.automation.findUnique({ where: { id: req.params.id } });
  if (!row || row.userId !== req.user!.id) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Automation not found.' } });
    return;
  }
  await prisma.automation.delete({ where: { id: row.id } });
  res.json({ data: { ok: true } });
});

/** Dry run: evaluate conditions and simulate actions without executing. */
automationsRouter.post('/:id/dry-run', async (req, res) => {
  const row = await prisma.automation.findUnique({ where: { id: req.params.id } });
  if (!row || row.userId !== req.user!.id) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Automation not found.' } });
    return;
  }
  const result = await runAutomation(row.id, { type: row.triggerType as never, userId: req.user!.id, vehicleId: row.vehicleId ?? undefined, data: (req.body ?? {}) as Record<string, unknown> }, { dryRun: true });
  res.json({ data: result });
});

/** Manual trigger for testing. */
automationsRouter.post('/:id/trigger', async (req, res) => {
  const row = await prisma.automation.findUnique({ where: { id: req.params.id } });
  if (!row || row.userId !== req.user!.id) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Automation not found.' } });
    return;
  }
  const result = await runAutomation(row.id, { type: row.triggerType as never, userId: req.user!.id, vehicleId: row.vehicleId ?? undefined, data: (req.body ?? {}) as Record<string, unknown> });
  res.json({ data: result });
});

automationsRouter.get('/:id/executions', async (req, res) => {
  const row = await prisma.automation.findUnique({ where: { id: req.params.id } });
  if (!row || row.userId !== req.user!.id) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Automation not found.' } });
    return;
  }
  const rows = await prisma.automationExecution.findMany({ where: { automationId: row.id }, orderBy: { triggeredAt: 'desc' }, take: 50 });
  res.json({
    data: rows.map((e) => ({
      id: e.id,
      automationId: e.automationId,
      triggeredAt: e.triggeredAt.toISOString(),
      triggerEvent: e.triggerEvent ?? undefined,
      conditionsMet: e.conditionsMet,
      result: e.result,
      actionResults: (e.actionResults ?? []) as unknown[],
      errorMessage: e.errorMessage ?? undefined,
    })),
  });
});

/** Incoming webhook trigger endpoint for user automations. */
automationsRouter.post('/webhook/:token', async (req, res) => {
  const token = req.params.token;
  const row = await prisma.automation.findFirst({ where: { triggerType: 'webhook', triggerParams: { path: ['token'], equals: token } } });
  if (!row) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown webhook token.' } });
    return;
  }
  const count = await dispatchTrigger({ type: 'webhook', userId: row.userId, vehicleId: row.vehicleId ?? undefined, data: req.body ?? {} });
  res.json({ data: { matched: count } });
});
