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
  // —— 图片（积分/张 + 输入词元）
  "image.per_1k": 24,
  "image.per_2k": 36,
  "image.per_4k": 48,
  "image.input_per_1m": 5300,
  // —— 视频（积分/千token；tokens=宽×高×帧率×秒÷1024，结算用方舟实际 usage）
  "video.720p.per_1k_tokens": 6.9,
  "video.1080p.per_1k_tokens": 7.65,
};

// 模型名 → 定价档位映射（裸名，§2）
export function llmPriceTier(model: string): "opus" | "sonnet" | "kimi" {
  if (model.includes("kimi")) return "kimi";
  return model.includes("opus") ? "opus" : "sonnet";
}
