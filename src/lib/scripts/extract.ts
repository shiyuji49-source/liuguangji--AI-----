// 服务端抽文本（§7）：.docx/.pdf/.txt → 纯文本，不跑 Python
export const MAX_FILE_BYTES = 30 * 1024 * 1024;
export const MAX_TEXT_CHARS = 800_000; // opus 1M 上下文安全余量

export class ExtractError extends Error {
  status = 400;
}

export async function extractTextFromFile(file: File) {
  if (file.size > MAX_FILE_BYTES) throw new ExtractError("文件超过 30MB");
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
    throw new ExtractError("仅支持 .docx / .pdf / .txt");
  }

  text = text.replace(/\r\n/g, "\n").trim();
  if (!text) throw new ExtractError("未能从文件中提取到文本");
  const truncated = text.length > MAX_TEXT_CHARS;
  if (truncated) text = text.slice(0, MAX_TEXT_CHARS);
  return { name, text, truncated };
}
