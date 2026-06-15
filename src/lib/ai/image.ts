/**
 * 图片生成 provider（经 DMXAPI，已实测）。两个模型两套协议，统一出 base64：
 * - gpt-image-2  → OpenAI Images 协议：/v1/images/generations（文生图）、/v1/images/edits（带参考图，multipart）
 * - gemini-3-pro-image(nano banana pro) → Gemini 协议：/v1beta/models/{m}:generateContent（参考图走 inline_data）
 * 计费与落库由调用方（charge.ts + storage）负责，本模块只管出图。
 */

const BASE = (process.env.DMXAPI_BASE_URL ?? "https://www.dmxapi.cn").replace(/\/+$/, "");
const KEY = () => process.env.DMXAPI_API_KEY ?? "";
// 压测结论：普通版又便宜又稳，ssvip 贵 1.5-2.5× 不划算、03 固定价不稳(429)。默认用普通版。
const GPT_MODEL = process.env.DMXAPI_GPT_IMAGE_MODEL ?? "gpt-image-2";
const NANO_MODEL = process.env.DMXAPI_NANO_IMAGE_MODEL ?? "gemini-3-pro-image";

export type ImageEngine = "gpt" | "nano";
export type ImageTier = "1k" | "2k" | "4k";
export type RefImage = { base64: string; mime: string };

export type GenImageInput = {
  engine: ImageEngine;
  prompt: string;
  tier: ImageTier;
  aspectRatio?: string; // "1:1" | "16:9" | "9:16" ...（默认按项目画幅）
  refImages?: RefImage[];
  n?: number;
};
export type GenImageResult = {
  images: { base64: string; contentType: string }[];
  model: string;
  usage?: Record<string, unknown>;
};

function authHeaders(extra?: Record<string, string>) {
  return { Authorization: `Bearer ${KEY()}`, ...extra };
}
function genError(msg: string, status = 502) {
  return Object.assign(new Error(msg), { status });
}

// gpt-image-2：tier → quality（低/中/高）；size 取 OpenAI 接受值（按画幅）
const GPT_QUALITY: Record<ImageTier, string> = { "1k": "low", "2k": "medium", "4k": "high" };
function gptSize(aspect?: string): string {
  if (aspect === "16:9") return "1536x1024";
  if (aspect === "9:16") return "1024x1536";
  return "1024x1024";
}

async function generateGpt(input: GenImageInput): Promise<GenImageResult> {
  const n = Math.max(1, Math.trunc(input.n ?? 1));
  const quality = GPT_QUALITY[input.tier];
  const size = gptSize(input.aspectRatio);
  let res: Response;

  if (input.refImages?.length) {
    // 图生图/编辑：multipart，字段 image 可多张
    const form = new FormData();
    form.set("model", GPT_MODEL);
    form.set("prompt", input.prompt);
    form.set("n", String(n));
    form.set("size", size);
    form.set("quality", quality);
    form.set("output_format", "png");
    input.refImages.forEach((r, i) => {
      const buf = Buffer.from(r.base64, "base64");
      form.append("image", new Blob([new Uint8Array(buf)], { type: r.mime }), `ref${i}.png`);
    });
    res = await fetch(`${BASE}/v1/images/edits`, { method: "POST", headers: authHeaders(), body: form });
  } else {
    res = await fetch(`${BASE}/v1/images/generations`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        model: GPT_MODEL,
        prompt: input.prompt,
        n,
        size,
        quality,
        output_format: "png",
      }),
    });
  }

  const json = await res.json().catch(() => null);
  if (!res.ok || !json) throw genError(`gpt-image-2 出图失败：${json?.error?.message ?? res.status}`);
  const data: Array<{ b64_json?: string; url?: string }> = json.data ?? [];
  const images = data
    .map((d) => (d.b64_json ? { base64: d.b64_json, contentType: "image/png" } : null))
    .filter((x): x is { base64: string; contentType: string } => !!x);
  if (images.length === 0) throw genError("gpt-image-2 未返回图像");
  return { images, model: GPT_MODEL, usage: json.usage };
}

async function generateNano(input: GenImageInput): Promise<GenImageResult> {
  const parts: Array<Record<string, unknown>> = [{ text: input.prompt }];
  for (const r of input.refImages ?? []) {
    parts.push({ inline_data: { mime_type: r.mime, data: r.base64 } });
  }
  const res = await fetch(`${BASE}/v1beta/models/${NANO_MODEL}:generateContent`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: {
          aspectRatio: input.aspectRatio ?? "1:1",
          imageSize: input.tier.toUpperCase(), // 1K/2K/4K
        },
      },
    }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json) throw genError(`nano banana 出图失败：${json?.error?.message ?? res.status}`);
  const respParts: Array<{ inlineData?: { data: string; mimeType?: string }; text?: string }> =
    json.candidates?.[0]?.content?.parts ?? [];
  const images: { base64: string; contentType: string }[] = [];
  for (const p of respParts) {
    if (p.inlineData?.data) {
      images.push({ base64: p.inlineData.data, contentType: p.inlineData.mimeType ?? "image/jpeg" });
    } else if (p.text?.startsWith("data:image")) {
      // 兜底：偶发把 base64 当 text 返回（dataURL）
      const m = p.text.match(/^data:([^;]+);base64,([\s\S]+)$/);
      if (m) images.push({ base64: m[2], contentType: m[1] });
    }
  }
  if (images.length === 0) throw genError("nano banana 未返回图像");
  return { images, model: NANO_MODEL, usage: json.usageMetadata };
}

/** 统一出图入口 */
export async function generateImage(input: GenImageInput): Promise<GenImageResult> {
  if (!KEY()) throw genError("未配置 DMXAPI_API_KEY", 500);
  return input.engine === "nano" ? generateNano(input) : generateGpt(input);
}
