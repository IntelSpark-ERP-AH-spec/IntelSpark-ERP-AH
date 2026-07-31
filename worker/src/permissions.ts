export const VALID_ROLES = [
  'admin',
  'commercial',
  'magasinier',
  'rh',
  'comptable',
  'financier',
  'technicien',
  'employe',
] as const;

export type RoleName = (typeof VALID_ROLES)[number];

/** Keep in lock-step with backend/auth.js ROLE_PERMISSIONS. */
export const ROLE_PERMISSIONS: Record<string, string[]> = {
  admin: ['*'],
  commercial: ['clients:read', 'clients:write', 'stock:read', 'documents:read', 'documents:write', 'dashboard:read', 'ai:use'],
  magasinier: ['stock:read', 'stock:write', 'warehouse:read', 'warehouse:write', 'stock:mouvements'],
  rh: ['rh:read', 'rh:write', 'rh:paies', 'rh:candidatures', 'rh:formations'],
  comptable: ['compta:read', 'compta:write', 'documents:read', 'clients:read'],
  financier: ['compta:read', 'compta:write', 'reporting:read'],
  technicien: ['atelier:read', 'atelier:write', 'vehicules:read', 'maintenance:read', 'maintenance:write'],
  employe: ['dashboard:read', 'profile:read', 'profile:write'],
};

export type PermissionUser = {
  id: string;
  role: string;
  department?: string | null;
  organization_id?: string | null;
  permissions?: string[];
};

export function getRolePermissions(role: string): string[] {
  return ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.employe;
}

export function hasPermission(user: PermissionUser | null | undefined, permission: string): boolean {
  if (!user) return false;
  const permissions = user.permissions?.length ? user.permissions : getRolePermissions(user.role);
  if (permissions.includes('*')) return true;
  return permissions.includes(permission);
}

export function hasRole(user: PermissionUser | null | undefined, ...roles: string[]): boolean {
  if (!user) return false;
  return roles.includes(user.role);
}

export function sameOrganization(
  user: PermissionUser | null | undefined,
  organizationId: string | null | undefined,
): boolean {
  if (!user || !organizationId) return false;
  return String(user.organization_id || 'org_default') === String(organizationId);
}

export function permissionDeniedResponse(): { error: string } {
  return { error: 'Permission refusée' };
}

export function roleDeniedResponse(): { error: string } {
  return { error: 'Rôle non autorisé' };
}

export function organizationDeniedResponse(): { error: string } {
  return { error: 'Organisation non autorisée' };
}
