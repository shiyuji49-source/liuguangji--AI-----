import { requireUser, toErrorResponse } from "@/lib/auth-helpers";

export const maxDuration = 120;

// 剧本上传抽文本（§7）：.docx/.txt/.pdf → 服务端抽文本交给 LLM，不跑 Python 脚本
const MAX_FILE_BYTES = 30 * 1024 * 1024;
const MAX_TEXT_CHARS = 800_000; // opus 1M 上下文的安全余量

export async function POST(req: Request) {
  try {
    await requireUser();
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return Response.json({ error: "缺少文件" }, { status: 400 });
    if (file.size > MAX_FILE_BYTES) return Response.json({ error: "文件超过 30MB" }, { status: 400 });

    const name = file.name;
    const lower = name.toLowerCase();
    const buf = Buffer.from(await file.arrayBuffer());

    let text: string;
    if (lower.endsWith(".docx")) {
      const mammoth = (await import("mammoth")).default;
      text = (await mammoth.extractRawText({ buffer: buf })).value;
    } else if (lower.endsWith(".pdf")) {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: new Uint8Array(buf) });
      try {
        text = (await parser.getText()).text;
      } finally {
        await parser.destroy();
      }
    } else if (lower.endsWith(".txt") || lower.endsWith(".md")) {
      text = buf.toString("utf8");
    } else {
      return Response.json({ error: "仅支持 .docx / .pdf / .txt" }, { status: 400 });
    }

    text = text.replace(/\r\n/g, "\n").trim();
    if (!text) return Response.json({ error: "未能从文件中提取到文本" }, { status: 400 });
    const truncated = text.length > MAX_TEXT_CHARS;
    if (truncated) text = text.slice(0, MAX_TEXT_CHARS);

    return Response.json({ name, text, chars: text.length, truncated });
  } catch (e) {
    return toErrorResponse(e);
  }
}
