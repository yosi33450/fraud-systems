import type { UserRole } from "@/lib/types";

export interface SessionActor {
  userId: string;
  role: UserRole;
  tenantId?: string;
}

export function assertTenantAccess(actor: SessionActor, requestedTenantId: string) {
  if (actor.role === "platform-owner") return;
  if (!actor.tenantId || actor.tenantId !== requestedTenantId) {
    throw new Error("TENANT_ACCESS_DENIED");
  }
}

export function canManageTeam(role: UserRole) {
  return role === "platform-owner" || role === "tenant-owner";
}

export function canDecideCase(role: UserRole) {
  return role !== "viewer";
}
