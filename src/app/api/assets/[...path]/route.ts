import { requireProjectMember, toErrorResponse } from "@/lib/auth-helpers";
import { getBuffer } from "@/lib/storage";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ path: string[] }> };

/**
 * 生成器产物的鉴权静态服务：key = projectId/xxx.png（assets.filePath 存的就是它）。
 * 以 key 首段 projectId 校验项目成员，非成员拿不到——产物不走 public、不公开直链。
 */
export async function GET(_req: Request, { params }: Params) {
  try {
    const { path: parts } = await params;
    if (!parts?.length) return new Response("Bad request", { status: 400 });
    const projectId = parts[0];
    await requireProjectMember(projectId); // 首段必须是用户有权的项目

    const file = await getBuffer(parts.join("/"));
    if (!file) return new Response("Not found", { status: 404 });

    return new Response(new Uint8Array(file.buffer), {
      headers: {
        "Content-Type": file.contentType,
        "Cache-Control": "private, max-age=86400",
        "Content-Length": String(file.buffer.length),
      },
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}
