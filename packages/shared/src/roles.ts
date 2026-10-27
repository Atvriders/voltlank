// VoltLink roles and permission model.

export const ROLES = [
  'OWNER',
  'ADMIN',
  'FLEET_MANAGER',
  'DRIVER',
  'VIEWER',
  'STATUS_MANAGER',
  'SUPPORT',
] as const;
export type Role = (typeof ROLES)[number];

/** Rank used for "at least this role" checks. Higher = more privilege. */
export const ROLE_RANK: Record<Role, number> = {
  OWNER: 100,
  ADMIN: 90,
  FLEET_MANAGER: 70,
  DRIVER: 50,
  VIEWER: 20,
  STATUS_MANAGER: 60,
  SUPPORT: 40,
};

/** Scoped role on a vehicle. */
export const VEHICLE_ROLES = ['owner', 'admin', 'driver', 'viewer'] as const;
export type VehicleRole = (typeof VEHICLE_ROLES)[number];

export function roleAtLeast(role: string, minimum: Role): boolean {
  const r = (ROLE_RANK as Record<string, number>)[role];
  return typeof r === 'number' && r >= ROLE_RANK[minimum];
}

export const PERMISSIONS = [
  'vehicles.read',
  'vehicles.command',
  'vehicles.command_high_risk',
  'vehicles.manage',
  'providers.manage',
  'users.manage',
  'fleet.manage',
  'automations.manage',
  'notifications.manage',
  'status.manage',
  'incidents.manage',
  'admin.read',
  'admin.write',
  'exports.read',
  'settings.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Permissions implied by each global role. */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  OWNER: [...PERMISSIONS],
  ADMIN: [
    'vehicles.read',
    'vehicles.command',
    'vehicles.command_high_risk',
    'vehicles.manage',
    'providers.manage',
    'users.manage',
    'fleet.manage',
    'automations.manage',
    'notifications.manage',
    'status.manage',
    'incidents.manage',
    'admin.read',
    'exports.read',
    'settings.manage',
  ],
  FLEET_MANAGER: [
    'vehicles.read',
    'vehicles.command',
    'vehicles.manage',
    'fleet.manage',
    'automations.manage',
    'notifications.manage',
    'exports.read',
  ],
  DRIVER: ['vehicles.read', 'vehicles.command'],
  VIEWER: ['vehicles.read'],
  STATUS_MANAGER: ['status.manage', 'incidents.manage', 'admin.read'],
  SUPPORT: ['vehicles.read', 'admin.read'],
};
