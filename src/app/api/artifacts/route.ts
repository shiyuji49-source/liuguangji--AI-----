import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { artifacts } from "@/lib/db/schema";
import { requireProjectMember, toErrorResponse } from "@/lib/auth-helpers";

const ARTIFACT_TYPES = ["剧本", "诊断报告", "资产清单", "资产提示词", "静帧提示词", "视频提示词"] as const;

// 项目产物列表（项目成员可见；?type= 过滤，供「带入资产清单」用）
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const projectId = url.searchParams.get("projectId");
    const type = url.searchParams.get("type");
    if (!projectId) return Response.json({ error: "缺少参数" }, { status: 400 });
    await requireProjectMember(projectId);

    const where = [eq(artifacts.projectId, projectId)];
    if (type) where.push(eq(artifacts.type, type as (typeof ARTIFACT_TYPES)[number]));
    const rows = await db
      .select()
      .from(artifacts)
      .where(and(...where))
      .orderBy(desc(artifacts.createdAt))
      .limit(100);
    return Response.json({ artifacts: rows });
  } catch (e) {
    return toErrorResponse(e);
  }
}

// 存为产物（消息内容归档）
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = z
      .object({
        projectId: z.string().uuid(),
        type: z.enum(ARTIFACT_TYPES),
        title: z.string().trim().min(1).max(80),
        content: z.string().min(1).max(900_000),
        sourceConversationId: z.string().uuid().optional(),
      })
      .safeParse(body);
    if (!parsed.success) return Response.json({ error: "参数不正确" }, { status: 400 });
    const { user } = await requireProjectMember(parsed.data.projectId);

    const [row] = await db
      .insert(artifacts)
      .values({
        projectId: parsed.data.projectId,
        type: parsed.data.type,
        title: parsed.data.title,
        content: parsed.data.content,
        sourceConversationId: parsed.data.sourceConversationId ?? null,
        createdBy: user.id,
      })
      .returning();
    return Response.json({ artifact: row });
  } catch (e) {
    return toErrorResponse(e);
  }
}
