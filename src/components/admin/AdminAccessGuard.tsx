import type { ReactNode } from "react";

export type AdminAccessGuardUser = {
  id?: string | null;
  email?: string | null;
  name?: string | null;
  role?: string | null;
  isAdmin?: boolean | null;
  app_metadata?: Record<string, unknown> | null;
  user_metadata?: Record<string, unknown> | null;
};

export type AdminAccessGuardProps = {
  children: ReactNode;
  user?: AdminAccessGuardUser | null;
  isAllowed?: boolean;
  loading?: boolean;
  allowedRoles?: string[];
  allowedEmails?: string[];
  fallback?: ReactNode;
  loadingFallback?: ReactNode;
  title?: string;
  description?: string;
};

function canAccessAdmin(isAllowed: boolean | undefined) {
  return isAllowed === true;
}

export function AdminAccessGuard({
  children,
  user,
  isAllowed,
  loading,
  fallback,
  loadingFallback,
  title = "无权访问管理员分析",
  description = "当前账号没有管理员访问权限。如需查看用户行为数据，请联系系统管理员开通访问。"
}: AdminAccessGuardProps) {
  if (loading) {
    return (
      <>
        {loadingFallback ?? (
          <section className="admin-analytics-access admin-analytics-access-loading" role="status" aria-live="polite">
            <h2 className="admin-analytics-access-title">正在校验管理员权限</h2>
            <p className="admin-analytics-access-description">请稍候，系统正在确认当前账号的访问范围。</p>
          </section>
        )}
      </>
    );
  }

  if (!canAccessAdmin(isAllowed)) {
    return (
      <>
        {fallback ?? (
          <section className="admin-analytics-access admin-analytics-access-denied" role="status" aria-live="polite">
            <h2 className="admin-analytics-access-title">{title}</h2>
            <p className="admin-analytics-access-description">{description}</p>
          </section>
        )}
      </>
    );
  }

  return <>{children}</>;
}
