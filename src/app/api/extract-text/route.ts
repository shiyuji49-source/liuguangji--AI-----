import { requireUser, toErrorResponse } from "@/lib/auth-helpers";
import { extractTextFromFile } from "@/lib/scripts/extract";

export const maxDuration = 120;

// 通用抽文本（提示词生成器等处的附件用；剧本医生走项目级剧本上传）
export async function POST(req: Request) {
  try {
    await requireUser();
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return Response.json({ error: "缺少文件" }, { status: 400 });

    const { name, text, truncated } = await extractTextFromFile(file);
    if (truncated) {
      return Response.json({ name, text, chars: text.length, truncated: true });
    }
    return Response.json({ name, text, chars: text.length, truncated: false });
  } catch (e) {
    return toErrorResponse(e);
  }
}
