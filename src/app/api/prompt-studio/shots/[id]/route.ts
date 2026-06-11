import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { shots } from "@/lib/db/schema";
import { toErrorResponse } from "@/lib/auth-helpers";
import { loadShotChecked } from "@/lib/prompt-studio/access";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  sceneLabel: z.string().max(60).optional(),
  summary: z.string().max(500).optional(),
  shotType: z.string().max(30).optional(),
  cameraMove: z.string().max(60).optional(),
  dialogue: z.string().max(300).optional(),
  durationSec: z.number().int().min(1).max(60).nullable().optional(),
  assetRefs: z.array(z.string().max(40)).max(12).optional(),
  needStill: z.boolean().optional(),
  stillPrompt: z.string().max(20000).optional(),
  videoPrompt: z.string().max(20000).optional(),
});

export async function PATCH(req: Request, { params }: Params) {
  try {
    const { id } = await params;
    await loadShotChecked(id);
    const body = await req.json().catch(() => null);
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success || Object.keys(parsed.data).length === 0) {
      return Response.json({ error: "参数不正确" }, { status: 400 });
    }
    const patch: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };
    // 手动改提示词 = 已确认内容
    if (parsed.data.stillPrompt !== undefined) patch.stillState = "done";
    if (parsed.data.videoPrompt !== undefined) patch.videoState = "done";
    await db.update(shots).set(patch).where(eq(shots.id, id));
    return Response.json({ ok: true });
  } catch (e) {
    return toErrorResponse(e);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const { id } = await params;
    await loadShotChecked(id);
    await db.delete(shots).where(eq(shots.id, id));
    return Response.json({ ok: true });
  } catch (e) {
    return toErrorResponse(e);
  }
}
