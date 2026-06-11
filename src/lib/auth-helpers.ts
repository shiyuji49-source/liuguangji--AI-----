import { eq, and } from "drizzle-orm";
import { auth } from "./auth";
import { db } from "./db";
import { users, memberships, projects, type ProjectRole } from "./db/schema";

export class AuthError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

/** 页面用：取当前用户（未登录/被封返回 null，由页面自行 redirect） */
export async function currentUser() {
  try {
    return await requireUser();
  } catch {
    return null;
  }
}

/**
 * 所有需要登录的 server 逻辑统一入口：取 session 后回查 DB 的最新状态，
 * 保证封号/改角色立即生效（JWT 本身不撤销）。
 */
export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) throw new AuthError("未登录", 401);
  const user = await db.query.users.findFirst({ where: eq(users.id, session.user.id) });
  if (!user) throw new AuthError("用户不存在", 401);
  if (user.status !== "active") throw new AuthError("账号已被停用", 403);
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "admin") throw new AuthError("需要管理员权限", 403);
  return user;
}

/** 项目成员校验；平台管理员视同可访问全部项目（运营需要） */
export async function requireProjectMember(projectId: string, allowedRoles?: ProjectRole[]) {
  const user = await requireUser();
  const project = await db.query.projects.findFirst({ where: eq(projects.id, projectId) });
  if (!project) throw new AuthError("项目不存在", 404);
  if (user.role === "admin") return { user, project, projectRole: "director" as ProjectRole };

  const membership = await db.query.memberships.findFirst({
    where: and(eq(memberships.projectId, projectId), eq(memberships.userId, user.id)),
  });
  if (!membership) throw new AuthError("不是该项目成员", 403);
  if (allowedRoles && !allowedRoles.includes(membership.projectRole)) {
    throw new AuthError("当前项目角色无权执行此操作", 403);
  }
  return { user, project, projectRole: membership.projectRole };
}

/** API 路由错误统一转 Response（兼容带 status 的业务错误，如积分不足 402） */
export function toErrorResponse(e: unknown) {
  if (e instanceof Error && typeof (e as { status?: unknown }).status === "number") {
    return Response.json({ error: e.message }, { status: (e as unknown as { status: number }).status });
  }
  console.error(e);
  return Response.json({ error: "服务器内部错误" }, { status: 500 });
}
