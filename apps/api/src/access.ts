// Per-vehicle authorization: ownership + granted permissions + org roles.
// Never trust client-supplied IDs — every lookup re-derives access.

import { prisma } from './core/db';
import { ROLE_RANK, type Role } from '@voltlink/shared';
import type { Prisma } from '@prisma/client';

export type VehicleWithState = Prisma.VehicleGetPayload<{ include: { snapshot: true; providerAccount: true } }>;

export class AccessError extends Error {
  status: number;
  code: string;
  constructor(code: string, message: string, status = 403) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** Roles that can see every vehicle in the instance (org-wide fleet view). */
const ORG_READ_ROLES: Role[] = ['OWNER', 'ADMIN', 'FLEET_MANAGER'];

export async function loadVehicleForUser(vehicleId: string, userId: string, role: string): Promise<VehicleWithState> {
  const vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
    include: { snapshot: true, providerAccount: true },
  });
  if (!vehicle) throw new AccessError('NOT_FOUND', 'Vehicle not found.', 404);
  const granted = await prisma.vehiclePermission.findUnique({
    where: { vehicleId_userId: { vehicleId, userId } },
  });
  const orgLevel = ROLE_RANK[role as Role] ?? 0;
  const canRead = vehicle.ownerId === userId || !!granted || orgLevel >= ROLE_RANK.FLEET_MANAGER;
  if (!canRead) throw new AccessError('FORBIDDEN', 'You do not have access to this vehicle.');
  return vehicle;
}

export async function assertCommandPermission(vehicle: VehicleWithState, userId: string, role: string, highRisk: boolean): Promise<void> {
  const granted = await prisma.vehiclePermission.findUnique({
    where: { vehicleId_userId: { vehicleId: vehicle.id, userId } },
  });
  const orgLevel = ROLE_RANK[role as Role] ?? 0;
  const isOwner = vehicle.ownerId === userId;
  const orgCanCommand = orgLevel >= ROLE_RANK.FLEET_MANAGER && !highRisk;
  const orgCanHighRisk = orgLevel >= ROLE_RANK.ADMIN && highRisk;
  if (!isOwner && !granted && !orgCanCommand && !orgCanHighRisk) {
    throw new AccessError('FORBIDDEN', 'You do not have permission to command this vehicle.');
  }
  if (granted && highRisk && granted.level !== 'driver' && !isOwner) {
    throw new AccessError('FORBIDDEN', 'High-risk commands require owner or driver-level access.');
  }
  if (granted && !highRisk && granted.level === 'viewer') {
    throw new AccessError('FORBIDDEN', 'Viewer-level access cannot issue commands.');
  }
}

export async function listVehiclesForUser(userId: string, role: string): Promise<VehicleWithState[]> {
  const orgLevel = ROLE_RANK[role as Role] ?? 0;
  if (ORG_READ_ROLES.includes(role as Role) || orgLevel >= ROLE_RANK.FLEET_MANAGER) {
    return prisma.vehicle.findMany({
      where: { active: true },
      include: { snapshot: true, providerAccount: true },
      orderBy: { displayName: 'asc' },
    });
  }
  const [owned, grantedRows] = await Promise.all([
    prisma.vehicle.findMany({ where: { ownerId: userId, active: true }, include: { snapshot: true, providerAccount: true } }),
    prisma.vehiclePermission.findMany({ where: { userId }, select: { vehicleId: true } }),
  ]);
  if (grantedRows.length === 0) return owned;
  const granted = await prisma.vehicle.findMany({
    where: { id: { in: grantedRows.map((g) => g.vehicleId) }, active: true },
    include: { snapshot: true, providerAccount: true },
  });
  const map = new Map<string, VehicleWithState>();
  for (const v of [...owned, ...granted]) map.set(v.id, v);
  return [...map.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
}
