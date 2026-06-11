import { z } from "zod";
import { db } from "@/lib/db";
import { projects, memberships } from "@/lib/db/schema";
import { requireUser, toErrorResponse, AuthError } from "@/lib/auth-helpers";

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    // 导演角色可建项目（§4）；平台管理员同样允许
    if (user.role !== "director" && user.role !== "admin") {
      throw new AuthError("只有导演角色可以创建项目", 403);
    }
    const body = await req.json().catch(() => null);
    const parsed = z
      .object({ name: z.string().trim().min(1, "请填写项目名称").max(80), tier: z.enum(["B", "A", "S"]) })
      .safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const [project] = await db
      .insert(projects)
      .values({ name: parsed.data.name, tier: parsed.data.tier, createdBy: user.id })
      .returning();
    // 创建者自动成为项目导演
    await db.insert(memberships).values({
      userId: user.id,
      projectId: project.id,
      projectRole: "director",
    });
    return Response.json({ id: project.id });
  } catch (e) {
    return toErrorResponse(e);
  }
}
