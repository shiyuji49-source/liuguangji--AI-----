import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { videoSegments } from "@/lib/db/schema";
import { toErrorResponse } from "@/lib/auth-helpers";
import { loadSegmentChecked } from "@/lib/prompt-studio/access";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  try {
    const { id } = await params;
    await loadSegmentChecked(id);
    const body = await req.json().catch(() => null);
    const parsed = z
      .object({
        prompt: z.string().max(20000).optional(),
        label: z.string().max(60).optional(),
        shotNos: z.array(z.number().int().positive()).min(1).max(30).optional(),
        durationSec: z.number().int().min(1).max(15).nullable().optional(),
      })
      .safeParse(body);
    if (!parsed.success || Object.keys(parsed.data).length === 0) {
      return Response.json({ error: "参数不正确" }, { status: 400 });
    }
    const patch: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };
    if (parsed.data.prompt !== undefined) patch.state = "done"; // 手动编辑=已确认
    await db.update(videoSegments).set(patch).where(eq(videoSegments.id, id));
    return Response.json({ ok: true });
  } catch (e) {
    return toErrorResponse(e);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const { id } = await params;
    await loadSegmentChecked(id);
    await db.delete(videoSegments).where(eq(videoSegments.id, id));
    return Response.json({ ok: true });
  } catch (e) {
    return toErrorResponse(e);
  }
}
