// Vehicle routes: listing, state, places, geofences, privacy zones, and
// per-vehicle permissions.

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../core/db';
import { requireAuth } from '../auth/middleware';
import { loadVehicleForUser, listVehiclesForUser } from '../access';
import { ingestVehicleState } from '../telemetry/ingest';
import { getProvider } from '../providers/registry';
import { buildContext } from '../providers/registry';
import { getQueue } from '../core/queue';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { haversineKm } from '../core/geo';

export const vehiclesRouter = Router();

vehiclesRouter.use(requireAuth);

function toVehicleWithState(v: {
  id: string; displayName: string; provider: string; providerVehicleId: string; vehicleClass: string;
  make: string | null; model: string | null; year: number | null; exteriorColor: string | null;
  wheelStyle: string | null; vinLast4: string | null; capabilities: unknown; demo: boolean; ownerId: string;
  providerAccountId: string; createdAt: Date; updatedAt: Date;
  snapshot: { state: unknown; fetchedAt: Date; freshness: string } | null;
  providerAccount: { label: string };
}) {
  return {
    id: v.id,
    displayName: v.displayName,
    provider: v.provider,
    providerVehicleId: v.providerVehicleId,
    vehicleClass: v.vehicleClass,
    make: v.make ?? undefined,
    model: v.model ?? undefined,
    year: v.year ?? undefined,
    exteriorColor: v.exteriorColor ?? undefined,
    wheelStyle: v.wheelStyle ?? undefined,
    vinLast4: v.vinLast4 ?? undefined,
    capabilities: (v.capabilities ?? []) as string[],
    demo: v.demo,
    ownerId: v.ownerId,
    providerAccountId: v.providerAccountId,
    providerAccountLabel: v.providerAccount.label,
    groupIds: [] as string[],
    createdAt: v.createdAt.toISOString(),
    state: v.snapshot ? { ...(v.snapshot.state as object), freshness: v.snapshot.freshness, fetchedAt: v.snapshot.fetchedAt.toISOString() } : null,
  };
}

vehiclesRouter.get('/', async (req, res) => {
  const vehicles = await listVehiclesForUser(req.user!.id, req.user!.role);
  const groupLinks = await prisma.fleetGroupVehicle.findMany({
    where: { vehicleId: { in: vehicles.map((v) => v.id) } },
  });
  const groups = new Map<string, string[]>();
  for (const g of groupLinks) {
    groups.set(g.vehicleId, [...(groups.get(g.vehicleId) ?? []), g.fleetGroupId]);
  }
  res.json({ data: vehicles.map((v) => ({ ...toVehicleWithState(v), groupIds: groups.get(v.id) ?? [] })) });
});

// ---- Privacy zones ----

vehiclesRouter.get('/privacy-zones', async (req, res) => {
  const rows = await prisma.privacyZone.findMany({ where: { userId: req.user!.id }, orderBy: { name: 'asc' } });
  res.json({ data: rows });
});

const privacySchema = z.object({ name: z.string().min(1).max(60), lat: z.number(), lon: z.number(), radiusM: z.number().min(50).max(10000) });

vehiclesRouter.post('/privacy-zones', async (req, res) => {
  const parsed = privacySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION', message: 'Privacy zone needs name, lat, lon, radiusM.' } });
    return;
  }
  const z = await prisma.privacyZone.create({ data: { userId: req.user!.id, ...parsed.data } });
  res.status(201).json({ data: z });
});


vehiclesRouter.get('/:id', async (req, res) => {
  const vehicle = await loadVehicleForUser(req.params.id, req.user!.id, req.user!.role);
  res.json({ data: toVehicleWithState(vehicle) });
});

vehiclesRouter.get('/:id/state', async (req, res) => {
  const vehicle = await loadVehicleForUser(req.params.id, req.user!.id, req.user!.role);
  res.json({ data: vehicle.snapshot?.state ?? null });
});

/** Refresh state on demand (rate limited by the queue dedupe). */
vehiclesRouter.post('/:id/refresh', async (req, res) => {
  const vehicle = await loadVehicleForUser(req.params.id, req.user!.id, req.user!.role);
  if (vehicle.demo) {
    // Demo refresh is synchronous and cheap.
    const ctx = await buildContext(vehicle.providerAccount);
    const result = await getProvider('demo').fetchState(ctx, vehicle.providerVehicleId);
    await ingestVehicleState(vehicle, { ...(result.state as Record<string, unknown>), vehicleId: vehicle.id, provider: 'demo', providerVehicleId: vehicle.providerVehicleId, fetchedAt: new Date().toISOString() } as never, { live: true });
    res.json({ data: { queued: false } });
    return;
  }
  await getQueue().enqueue('telemetry', { accountId: vehicle.providerAccountId, vehicleId: vehicle.id, providerVehicleId: vehicle.providerVehicleId }, { dedupeKey: `refresh:${vehicle.id}:${Math.floor(Date.now() / 30_000)}` });
  res.json({ data: { queued: true } });
});

vehiclesRouter.patch('/:id', async (req, res) => {
  const vehicle = await loadVehicleForUser(req.params.id, req.user!.id, req.user!.role);
  const owner = vehicle.ownerId === req.user!.id;
  const body = (req.body ?? {}) as { displayName?: string; exteriorColor?: string };
  const data: Record<string, unknown> = {};
  if (owner && typeof body.displayName === 'string' && body.displayName.trim()) data.displayName = body.displayName.trim().slice(0, 60);
  if (typeof body.exteriorColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.exteriorColor)) data.exteriorColor = body.exteriorColor;
  if (Object.keys(data).length > 0) {
    await prisma.vehicle.update({ where: { id: vehicle.id }, data });
  }
  res.json({ data: { ok: true } });
});

// ---- Per-vehicle permissions ----

vehiclesRouter.get('/:id/permissions', async (req, res) => {
  const vehicle = await loadVehicleForUser(req.params.id, req.user!.id, req.user!.role);
  if (vehicle.ownerId !== req.user!.id) {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only the owner manages permissions.' } });
    return;
  }
  const rows = await prisma.vehiclePermission.findMany({ where: { vehicleId: vehicle.id } });
  const users = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true, email: true, name: true } });
  const byId = new Map(users.map((u) => [u.id, u]));
  res.json({
    data: rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      userEmail: byId.get(r.userId)?.email ?? 'unknown',
      level: r.level,
      createdAt: r.createdAt.toISOString(),
    })),
  });
});

vehiclesRouter.post('/:id/permissions', async (req, res) => {
  const vehicle = await loadVehicleForUser(req.params.id, req.user!.id, req.user!.role);
  if (vehicle.ownerId !== req.user!.id) {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only the owner manages permissions.' } });
    return;
  }
  const { email, level } = (req.body ?? {}) as { email?: string; level?: string };
  if (!email || !['driver', 'viewer'].includes(level ?? '')) {
    res.status(400).json({ error: { code: 'VALIDATION', message: 'email and level (driver|viewer) required.' } });
    return;
  }
  const target = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!target || target.id === req.user!.id) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No other user with that email exists.' } });
    return;
  }
  await prisma.vehiclePermission.upsert({
    where: { vehicleId_userId: { vehicleId: vehicle.id, userId: target.id } },
    update: { level },
    create: { ownerId: req.user!.id, vehicleId: vehicle.id, userId: target.id, level },
  });
  res.status(201).json({ data: { ok: true } });
});

vehiclesRouter.delete('/:id/permissions/:permId', async (req, res) => {
  const vehicle = await loadVehicleForUser(req.params.id, req.user!.id, req.user!.role);
  if (vehicle.ownerId !== req.user!.id) {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only the owner manages permissions.' } });
    return;
  }
  const row = await prisma.vehiclePermission.findUnique({ where: { id: req.params.permId } });
  if (!row || row.vehicleId !== vehicle.id) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Permission not found.' } });
    return;
  }
  await prisma.vehiclePermission.delete({ where: { id: row.id } });
  res.json({ data: { ok: true } });
});

// ---- Places ----

vehiclesRouter.get('/places/all', async (req, res) => {
  const places = await prisma.place.findMany({ where: { userId: req.user!.id }, orderBy: { name: 'asc' } });
  res.json({ data: places.map((p) => ({ ...p, createdAt: undefined })) });
});

const placeSchema = z.object({ name: z.string().min(1).max(60), type: z.string(), lat: z.number(), lon: z.number(), radiusM: z.number().min(10).max(5000).optional() });

vehiclesRouter.post('/places/all', async (req, res) => {
  const parsed = placeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION', message: 'Place needs name, type, lat, lon.' } });
    return;
  }
  const place = await prisma.place.create({ data: { userId: req.user!.id, ...parsed.data, radiusM: parsed.data.radiusM ?? 100 } });
  res.status(201).json({ data: place });
});

vehiclesRouter.delete('/places/all/:id', async (req, res) => {
  const place = await prisma.place.findUnique({ where: { id: req.params.id } });
  if (!place || place.userId !== req.user!.id) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Place not found.' } });
    return;
  }
  await prisma.place.delete({ where: { id: place.id } });
  res.json({ data: { ok: true } });
});

// ---- Geofences ----

vehiclesRouter.get('/geofences/all', async (req, res) => {
  const rows = await prisma.geofence.findMany({ where: { userId: req.user!.id }, orderBy: { name: 'asc' } });
  res.json({ data: rows.map((g) => ({ ...g, lastTriggeredAt: g.lastTriggeredAt?.toISOString() })) });
});

const fenceSchema = z.object({ name: z.string().min(1).max(60), lat: z.number(), lon: z.number(), radiusM: z.number().min(10).max(10000), alertOn: z.enum(['enter', 'leave', 'both']) });

vehiclesRouter.post('/geofences/all', async (req, res) => {
  const parsed = fenceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION', message: 'Geofence needs name, lat, lon, radiusM, alertOn.' } });
    return;
  }
  const g = await prisma.geofence.create({ data: { userId: req.user!.id, ...parsed.data } });
  res.status(201).json({ data: g });
});

vehiclesRouter.patch('/geofences/all/:id', async (req, res) => {
  const row = await prisma.geofence.findUnique({ where: { id: req.params.id } });
  if (!row || row.userId !== req.user!.id) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Geofence not found.' } });
    return;
  }
  const body = (req.body ?? {}) as { enabled?: boolean; name?: string; radiusM?: number; alertOn?: string };
  const data: Record<string, unknown> = {};
  if (typeof body.enabled === 'boolean') data.enabled = body.enabled;
  if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim().slice(0, 60);
  if (typeof body.radiusM === 'number') data.radiusM = body.radiusM;
  if (['enter', 'leave', 'both'].includes(body.alertOn ?? '')) data.alertOn = body.alertOn;
  await prisma.geofence.update({ where: { id: row.id }, data });
  res.json({ data: { ok: true } });
});

vehiclesRouter.delete('/geofences/all/:id', async (req, res) => {
  const row = await prisma.geofence.findUnique({ where: { id: req.params.id } });
  if (!row || row.userId !== req.user!.id) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Geofence not found.' } });
    return;
  }
  await prisma.geofence.delete({ where: { id: row.id } });
  res.json({ data: { ok: true } });
});

vehiclesRouter.patch('/privacy-zones/:id', async (req, res) => {
  const row = await prisma.privacyZone.findUnique({ where: { id: req.params.id } });
  if (!row || row.userId !== req.user!.id) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Privacy zone not found.' } });
    return;
  }
  const body = (req.body ?? {}) as { enabled?: boolean };
  await prisma.privacyZone.update({ where: { id: row.id }, data: { enabled: body.enabled ?? row.enabled } });
  res.json({ data: { ok: true } });
});

vehiclesRouter.delete('/privacy-zones/:id', async (req, res) => {
  const row = await prisma.privacyZone.findUnique({ where: { id: req.params.id } });
  if (!row || row.userId !== req.user!.id) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Privacy zone not found.' } });
    return;
  }
  await prisma.privacyZone.delete({ where: { id: row.id } });
  res.json({ data: { ok: true } });
});
