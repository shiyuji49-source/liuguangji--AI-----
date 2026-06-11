import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, memberships } from "@/lib/db/schema";
import { requireProjectMember, toErrorResponse } from "@/lib/auth-helpers";

type Params = { params: Promise<{ id: string }> };

// 项目成员列表（成员 Rail 用；任意项目成员可读）
export async function GET(_req: Request, { params }: Params) {
  try {
    const { id } = await params;
    await requireProjectMember(id);
    const rows = await db
      .select({ userId: memberships.userId, name: users.name, role: memberships.projectRole })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .where(eq(memberships.projectId, id));
    return Response.json({ members: rows });
  } catch (e) {
    return toErrorResponse(e);
  }
}

// 邀请已注册用户进项目并指定项目内角色（仅项目导演）
export async function POST(req: Request, { params }: Params) {
  try {
    const { id } = await params;
    await requireProjectMember(id, ["director"]);

    const body = await req.json().catch(() => null);
    const parsed = z
      .object({
        identifier: z.string().trim().min(1),
        role: z.enum(["director", "storyboard", "artist", "post"]),
      })
      .safeParse(body);
    if (!parsed.success) return Response.json({ error: "参数不正确" }, { status: 400 });

    const { identifier, role } = parsed.data;
    const target = await db.query.users.findFirst({
      where: identifier.includes("@")
        ? eq(users.email, identifier.toLowerCase())
        : eq(users.phone, identifier),
    });
    if (!target) return Response.json({ error: "该用户尚未注册，请先让对方注册账号" }, { status: 404 });
    if (target.status !== "active") return Response.json({ error: "该账号已被停用" }, { status: 400 });

    const exists = await db.query.memberships.findFirst({
      where: and(eq(memberships.projectId, id), eq(memberships.userId, target.id)),
    });
    if (exists) return Response.json({ error: "该用户已是项目成员" }, { status: 409 });

    await db.insert(memberships).values({ userId: target.id, projectId: id, projectRole: role });
    return Response.json({ ok: true });
  } catch (e) {
    return toErrorResponse(e);
  }
}

export async function DELETE(req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const { user } = await requireProjectMember(id, ["director"]);

    const body = await req.json().catch(() => null);
    const parsed = z.object({ userId: z.string().uuid() }).safeParse(body);
    if (!parsed.success) return Response.json({ error: "参数不正确" }, { status: 400 });
    if (parsed.data.userId === user.id) {
      return Response.json({ error: "不能移除自己" }, { status: 400 });
    }

    await db
      .delete(memberships)
      .where(and(eq(memberships.projectId, id), eq(memberships.userId, parsed.data.userId)));
    return Response.json({ ok: true });
  } catch (e) {
    return toErrorResponse(e);
  }
}
