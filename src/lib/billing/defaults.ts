// §6 默认定价表（seed 值；1 元 = 100 积分固定换算）。
// 单价一律存 pricing_config，admin 可改；代码不写死单价，只在 seed 时落库。
export const YUAN_TO_CREDITS = 100;

export const DEFAULT_PRICING: Record<string, number> = {
  // 默认加价倍率（admin 可改）
  markup: 1.5,
  // —— LLM（积分/百万词元；sonnet 为估价，上线前在 admin 按乐奇控制台实价核定）
  "llm.sonnet.in_per_1m": 2205,
  "llm.sonnet.out_per_1m": 11025,
  "llm.opus.in_per_1m": 3675,
  "llm.opus.out_per_1m": 18375,
  // kimi-k2.6 官方实价：输入 ¥6.5/M=650 积分、输出 ¥27/M=2700 积分（缓存命中沿用 cached_in_ratio）
  "llm.kimi.in_per_1m": 650,
  "llm.kimi.out_per_1m": 2700,
  "llm.cached_in_ratio": 0.1, // 缓存命中输入按 0.1× 计
  "llm.min_per_call": 5, // 单次最低收费（积分）
  // —— 图片（积分/张，按引擎×档位；DMXAPI 成本差异大，分开定价，admin 可改）
  // gpt-image-2：低/中/高 ≈ 成本 4/38/152 积分 ×~1.5 加价（DMXAPI 实价上线前核）
  "image.gpt.1k": 12,
  "image.gpt.2k": 60,
  "image.gpt.4k": 230,
  // nano banana pro(gemini-3-pro-image)：1K/2K 成本 ~97、4K ~173 ×~1.5
  "image.nano.1k": 150,
  "image.nano.2k": 150,
  "image.nano.4k": 260,
  "image.min_per_call": 5,
  // —— 视频（积分/千 token；结算用方舟实际 usage；Seedance 480p/720p/1080p 三档）
  "video.480p.per_1k_tokens": 5.0,
  "video.720p.per_1k_tokens": 6.9,
  "video.1080p.per_1k_tokens": 7.65,
};

// 模型名 → 定价档位映射（裸名，§2）
export function llmPriceTier(model: string): "opus" | "sonnet" | "kimi" {
  if (model.includes("kimi")) return "kimi";
  return model.includes("opus") ? "opus" : "sonnet";
}

// 图片模型 → 定价引擎键（gpt-image-2 → gpt；gemini-3-pro-image → nano）
export function imagePriceEngine(model: string): "gpt" | "nano" {
  return /gemini|nano/i.test(model) ? "nano" : "gpt";
}

export type ImageTier = "1k" | "2k" | "4k";
