import type { CurrentUserAccess, AdminProfileRole, AdminProfileStatus } from "../types/analytics";
import { isSupabaseConfigured, supabase } from "./supabase";

type ProfileAccessRow = {
  role: string | null;
  status: string | null;
};

export class AdminAccessError extends Error {
  public readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "AdminAccessError";
    this.cause = cause;
  }
}

export async function loadCurrentUserAccess(userId: string | null | undefined): Promise<CurrentUserAccess> {
  const normalizedUserId = userId ?? "";

  if (!normalizedUserId || !isSupabaseConfigured || !supabase) {
    return createAccess(normalizedUserId, "unknown", "unknown");
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("role,status")
    .eq("id", normalizedUserId)
    .maybeSingle();

  if (error) {
    throw new AdminAccessError("管理员权限读取失败。", error);
  }

  const profile = data as ProfileAccessRow | null;
  return createAccess(
    normalizedUserId,
    normalizeProfileRole(profile?.role),
    normalizeProfileStatus(profile?.status)
  );
}

export function isActiveAdminAccess(access: Pick<CurrentUserAccess, "role" | "status">): boolean {
  return access.role === "admin" && access.status === "active";
}

function createAccess(userId: string, role: AdminProfileRole, status: AdminProfileStatus): CurrentUserAccess {
  const isActive = status === "active";
  const isAdmin = role === "admin";

  return {
    userId,
    role,
    status,
    isActive,
    isAdmin,
    canAccessAdmin: isActive && isAdmin
  };
}

function normalizeProfileRole(role: string | null | undefined): AdminProfileRole {
  if (!role) return "unknown";
  if (role === "user" || role === "analyst" || role === "admin") return role;
  return role;
}

function normalizeProfileStatus(status: string | null | undefined): AdminProfileStatus {
  if (!status) return "unknown";
  if (status === "active" || status === "invited" || status === "suspended" || status === "deleted") return status;
  return status;
}
