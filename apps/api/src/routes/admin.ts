// Admin routes: users, roles, settings, retention, health, and demo controls.

import { Router } from 'express';
import { prisma } from '../core/db';
import { requireAuth, requireRole } from '../auth/middleware';
import { getSettingsBundle, setSetting, getSetting } from '../core/settings';
import { runRetention } from '../telemetry/retention';
import { getQueue } from '../core/queue';
import { sseCount } from '../core/sse';
import { env } from '../core/env';
import { APP_VERSION } from '@voltlink/shared';

export const adminRouter = Router();

adminRouter.use(requireAuth);

// ---- Settings (owner/admin write, others read) ----

adminRouter.get('/settings', async (req, res) => {
  const bundle = await getSettingsBundle();
  res.json({ data: { ...bundle, appVersion: APP_VERSION, demoDefaultEnabled: env.DEMO_DEFAULT_ENABLED } });
});

adminRouter.patch('/settings', requireRole('ADMIN'), async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const allowed = ['orgName', 'telemetryRetentionDays', 'locationRetentionDays'];
  for (const key of allowed) {
    if (typeof body[key] === 'string' && body[key]) {
      const v = String(body[key]);
      if (key.endsWith('Days') && (!/^\d+$/.test(v) || Number(v) < 7 || Number(v) > 3650)) {
        res.status(400).json({ error: { code: 'VALIDATION', message: `${key} must be a number of days between 7 and 3650.` } });
        return;
      }
      await setSetting(key, v.slice(0, 100));
    }
  }
  res.json({ data: { ok: true } });
});

// ---- Users ----

adminRouter.get('/users', requireRole('ADMIN'), async (req, res) => {
  const users = await prisma.user.findMany({ where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, include: { _count: { select: { vehicles: true } } } });
  res.json({
    data: users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      emailVerified: !!u.emailVerifiedAt,
      totpEnabled: u.totpEnabled,
      demoEnabled: u.demoEnabled,
      vehicleCount: u._count.vehicles,
      createdAt: u.createdAt.toISOString(),
    })),
  });
});

adminRouter.patch('/users/:id/role', requireRole('ADMIN'), async (req, res) => {
  const { role } = (req.body ?? {}) as { role?: string };
  const valid = ['OWNER', 'ADMIN', 'FLEET_MANAGER', 'DRIVER', 'VIEWER', 'STATUS_MANAGER', 'SUPPORT'];
  if (!valid.includes(role ?? '')) {
    res.status(400).json({ error: { code: 'VALIDATION', message: 'Invalid role.' } });
    return;
  }
  const target = await prisma.user.findUnique({ where: { id: String(req.params.id) } });
  if (!target) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found.' } });
    return;
  }
  if (target.id === req.user!.id && target.role === 'OWNER' && role !== 'OWNER') {
    res.status(400).json({ error: { code: 'VALIDATION', message: 'You cannot demote yourself from OWNER.' } });
    return;
  }
  await prisma.user.update({ where: { id: target.id }, data: { role } });
  res.json({ data: { ok: true } });
});

// ---- Health ----

adminRouter.get('/health', requireRole('ADMIN'), async (req, res) => {
  let database = 'ok';
  let migrationsCurrent = true;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    database = 'error';
    migrationsCurrent = false;
  }
  const queue = getQueue();
  const depth = await queue.depth('default').catch(() => -1);
  const workersActive = await prisma.backgroundJob.count({ where: { status: 'processing', lockedAt: { gt: new Date(Date.now() - 60_000) } } }).then((n) => n > 0);
  const freshSnap = await prisma.vehicleSnapshot.findFirst({ where: { fetchedAt: { gt: new Date(Date.now() - 15 * 60000) } } });
  res.json({
    data: {
      process: 'web',
      version: APP_VERSION,
      uptimeSec: Math.round(process.uptime()),
      database,
      redis: env.REDIS_URL ? ((await queue.ping().catch(() => false)) ? 'ok' : 'error') : 'unused',
      migrationsCurrent,
      queueDepth: depth,
      workersActive,
      schedulerActive: (await getSetting('schedulerBeat')) === '1' || env.NODE_ENV === 'test',
      telemetryFresh: !!freshSnap,
      memoryMb: Math.round(process.memoryUsage().rss / 1048576),
      sseClients: sseCount(),
    },
  });
});

adminRouter.post('/retention/run', requireRole('ADMIN'), async (_req, res) => {
  const result = await runRetention();
  res.json({ data: result });
});

adminRouter.post('/queue/:queueName/flush', requireRole('ADMIN'), async (req, res) => {
  const queueName = String(req.params.queueName).slice(0, 40);
  const n = await prisma.backgroundJob.updateMany({ where: { queue: queueName, status: 'dead' }, data: { status: 'pending', attempts: 0, runAt: new Date() } });
  res.json({ data: { requeued: n.count } });
});

adminRouter.get('/queue/dead', requireRole('ADMIN'), async (req, res) => {
  const rows = await prisma.backgroundJob.findMany({ where: { status: 'dead' }, orderBy: { doneAt: 'desc' }, take: 50 });
  res.json({
    data: rows.map((r) => ({ id: r.id, queue: r.queue, error: r.error ?? '', attempts: r.attempts, doneAt: r.doneAt?.toISOString(), payload: (() => { try { return JSON.parse(r.payload); } catch { return null; } })() })),
  });
});
