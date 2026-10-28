import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLE_PERMISSIONS, ROLE_RANK, ROLES, roleAtLeast, VEHICLE_ROLES } from './roles';
import { COMMAND_DEFINITIONS, COMMAND_STATUSES, HIGH_RISK_COMMANDS, RISK_LEVELS } from './commands';

describe('roles', () => {
  it('defines every role with a rank', () => {
    for (const role of ROLES) {
      expect(ROLE_RANK[role]).toBeTypeOf('number');
    }
  });

  it('owner outranks everything', () => {
    for (const role of ROLES) {
      if (role === 'OWNER') continue;
      expect(roleAtLeast('OWNER', role)).toBe(true);
    }
  });

  it('viewer does not pass admin checks', () => {
    expect(roleAtLeast('VIEWER', 'ADMIN')).toBe(false);
    expect(roleAtLeast('VIEWER', 'VIEWER')).toBe(true);
  });

  it('unknown roles fail every check', () => {
    expect(roleAtLeast('SUPERUSER', 'VIEWER')).toBe(false);
  });

  it('every permission is granted to at least one role', () => {
    const granted = new Set<string>();
    for (const role of ROLES) for (const p of ROLE_PERMISSIONS[role]) granted.add(p);
    for (const p of PERMISSIONS) expect(granted.has(p), `permission ${p} is unassigned`).toBe(true);
  });

  it('owner has every permission', () => {
    expect(new Set(ROLE_PERMISSIONS.OWNER).size).toBe(PERMISSIONS.length);
  });

  it('vehicle roles are a closed set', () => {
    expect(VEHICLE_ROLES).toEqual(['owner', 'admin', 'driver', 'viewer']);
  });
});

describe('command definitions', () => {
  it('every command has a definition', () => {
    for (const [name, def] of Object.entries(COMMAND_DEFINITIONS)) {
      expect(def.label.length).toBeGreaterThan(0);
      expect([...RISK_LEVELS]).toContain(def.risk);
      expect(name).toBeTypeOf('string');
    }
  });

  it('high-risk commands exist and have high risk', () => {
    expect(HIGH_RISK_COMMANDS.length).toBeGreaterThanOrEqual(3);
    for (const cmd of HIGH_RISK_COMMANDS) {
      expect(COMMAND_DEFINITIONS[cmd].risk).toBe('high');
    }
  });

  it('command statuses cover the full lifecycle', () => {
    for (const s of ['queued', 'submitted', 'accepted', 'confirmed', 'failed', 'rejected', 'unsupported', 'timed_out', 'canceled']) {
      expect(COMMAND_STATUSES).toContain(s);
    }
  });

  it('unlock, remote_start, sentry_mode are high-risk', () => {
    for (const cmd of ['unlock', 'remote_start', 'sentry_mode'] as const) {
      expect(HIGH_RISK_COMMANDS).toContain(cmd);
    }
  });

  it('honk_horn and flash_lights are low-risk', () => {
    expect(HIGH_RISK_COMMANDS).not.toContain('honk_horn');
    expect(HIGH_RISK_COMMANDS).not.toContain('flash_lights');
  });
});
