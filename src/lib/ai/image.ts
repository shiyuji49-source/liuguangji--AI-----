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

export type ImageQuality = "low" | "medium" | "high";
export type GenImageInput = {
  engine: ImageEngine;
  prompt: string;
  tier: ImageTier;
  aspectRatio?: string; // "1:1" | "16:9" | "9:16" ...（默认按项目画幅）
  quality?: ImageQuality; // gpt-image-2 画质档（低/中/高）；nano 无此参数
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

// gpt-image-2（DMXAPI / OpenAI Images）：**清晰度=分辨率档，画幅=精确比例 size**（不是 quality！）。
// 档位 × 比例 → size，均满足约束（边长≤3840、宽高均 16 倍数、比例≤3:1、总像素 65.5万~829万）。
// 1152×2048、2880² 等非枚举尺寸已实测 200 接受，证明 DMXAPI 按约束公式放行、非仅枚举表。
const GPT_SIZE_TABLE: Record<ImageTier, Record<string, string>> = {
  "1k": { "1:1": "1024x1024", "3:4": "768x1024", "9:16": "720x1280", "4:3": "1024x768", "16:9": "1280x720" },
  "2k": { "1:1": "2048x2048", "3:4": "1536x2048", "9:16": "1152x2048", "4:3": "2048x1536", "16:9": "2048x1152" },
  "4k": { "1:1": "2880x2880", "3:4": "2400x3200", "9:16": "2160x3840", "4:3": "3200x2400", "16:9": "3840x2160" },
};
function aspectOrient(aspect?: string): -1 | 0 | 1 {
  const [a, b] = (aspect ?? "").split(":").map(Number);
  if (!a || !b || a === b) return 0;
  return a > b ? 1 : -1; // 1 横 / -1 竖 / 0 方
}
function gptSize(tier: ImageTier, aspect?: string): string {
  if (aspect === "auto" || !aspect) return "auto"; // 自动：交给模型按提示词选最佳尺寸
  const t = GPT_SIZE_TABLE[tier];
  if (t[aspect]) return t[aspect];
  const o = aspectOrient(aspect); // 未列比例按朝向就近
  return o > 0 ? t["16:9"] : o < 0 ? t["9:16"] : t["1:1"];
}
// 画质默认中档（兼顾画质/速度/成本）；high 画质最好但慢很多（实测 1024/high≈210s），由调用方按需选。

async function generateGpt(input: GenImageInput): Promise<GenImageResult> {
  const n = Math.max(1, Math.trunc(input.n ?? 1));
  const quality = input.quality ?? "medium";
  const size = gptSize(input.tier, input.aspectRatio);
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
