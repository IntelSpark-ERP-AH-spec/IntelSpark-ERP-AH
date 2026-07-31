import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  getRolePermissions,
  hasPermission,
  hasRole,
  ROLE_PERMISSIONS,
  sameOrganization,
  VALID_ROLES,
} from './permissions';

const here = path.dirname(fileURLToPath(import.meta.url));
const backendAuthPath = path.resolve(here, '../../backend/auth.js');

function extractBackendRolePermissions(source: string): Record<string, string[]> {
  const match = source.match(/const ROLE_PERMISSIONS = \{([\s\S]*?)\n\};/);
  if (!match) throw new Error('ROLE_PERMISSIONS introuvable dans backend/auth.js');
  const body = match[1];
  const result: Record<string, string[]> = {};
  const roleRe = /(\w+)\s*:\s*\[([^\]]*)\]/g;
  let entry: RegExpExecArray | null;
  while ((entry = roleRe.exec(body))) {
    const role = entry[1];
    const perms = entry[2]
      .split(',')
      .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
    result[role] = perms;
  }
  return result;
}

describe('permissions parity with Express backend', () => {
  it('mirrors ROLE_PERMISSIONS from backend/auth.js', () => {
    const backend = fs.readFileSync(backendAuthPath, 'utf8');
    const backendPermissions = extractBackendRolePermissions(backend);
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual(Object.keys(backendPermissions).sort());
    for (const role of Object.keys(ROLE_PERMISSIONS)) {
      expect(ROLE_PERMISSIONS[role]).toEqual(backendPermissions[role]);
    }
  });

  it('exposes the same role vocabulary as Express VALID_ROLES', () => {
    const backend = fs.readFileSync(backendAuthPath, 'utf8');
    const match = backend.match(/export const VALID_ROLES = \[([^\]]+)\]/);
    expect(match).toBeTruthy();
    const backendRoles = match![1]
      .split(',')
      .map((item: string) => item.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
    expect([...VALID_ROLES]).toEqual(backendRoles);
  });
});

describe('permission helpers', () => {
  it('grants admin wildcard', () => {
    const admin = { id: '1', role: 'admin', permissions: getRolePermissions('admin') };
    expect(hasPermission(admin, 'stock:write')).toBe(true);
    expect(hasRole(admin, 'admin')).toBe(true);
  });

  it('restricts commercial permissions', () => {
    const commercial = { id: '2', role: 'commercial', permissions: getRolePermissions('commercial') };
    expect(hasPermission(commercial, 'clients:write')).toBe(true);
    expect(hasPermission(commercial, 'rh:write')).toBe(false);
    expect(hasRole(commercial, 'admin')).toBe(false);
  });

  it('checks organization scope', () => {
    const user = { id: '3', role: 'comptable', organization_id: 'org_default' };
    expect(sameOrganization(user, 'org_default')).toBe(true);
    expect(sameOrganization(user, 'org_other')).toBe(false);
  });
});
