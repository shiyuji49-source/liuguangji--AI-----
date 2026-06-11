import { z } from "zod";
import { db } from "@/lib/db";
import { projects, memberships } from "@/lib/db/schema";
import { requireUser, toErrorResponse, AuthError } from "@/lib/auth-helpers";

const specSchema = {
  tier: z.enum(["B", "A", "S"]).default("B"),
  aspect: z.string().max(20).default("9:16"),
  productionType: z.enum(["真人", "3D", "2D"]).default("真人"),
  styleGenre: z.string().trim().max(40).optional(),
};

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    // 导演角色可建项目（§4）；平台管理员同样允许
    if (user.role !== "director" && user.role !== "admin") {
      throw new AuthError("只有导演角色可以创建项目", 403);
    }
    const body = await req.json().catch(() => null);
    const parsed = z
      .object({ name: z.string().trim().min(1, "请填写项目名称").max(80), ...specSchema })
      .safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const { name, tier, aspect, productionType, styleGenre } = parsed.data;

    const [project] = await db
      .insert(projects)
      .values({ name, tier, aspect, productionType, styleGenre: styleGenre || null, createdBy: user.id })
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
