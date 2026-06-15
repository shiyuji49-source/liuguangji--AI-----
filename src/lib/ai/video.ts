/**
 * 视频生成 provider（火山方舟 Seedance，已用 1.0-pro 实测整套 API）。
 * 异步：创建任务(cgt-xxx) → 轮询直到 succeeded → 取签名 video_url(~24h 过期，调用方须转存)。
 * 参数用 Seedance 的 --flag 写进 text；model 由 env 配（开通 2.0 后改 ARK_SEEDANCE_MODEL 即切）。
 */
const BASE = (process.env.ARK_BASE_URL ?? "https://ark.cn-beijing.volces.com").replace(/\/+$/, "");
const KEY = () => process.env.ARK_API_KEY ?? "";
// Seedance 2.0（已开通，实测可用）；2.0 fast 设 doubao-seedance-2-0-fast-* ；1.0 pro 设其 id
const MODEL = () => process.env.ARK_SEEDANCE_MODEL ?? "doubao-seedance-2-0-260128";

export type VideoResolution = "480p" | "720p" | "1080p";
// 参考图角色：首帧/尾帧（图生视频）/参考图（2.0 多模态，1-9 张）。三场景互斥不可混用。
// ⚠️Seedance 2.0 不支持直接传含真人人脸的参考图（需用预置虚拟人像/已授权素材，见 docs）。
export type FrameRole = "first_frame" | "last_frame" | "reference_image";
export type VideoRef = { base64: string; mime: string; role: FrameRole };

export type CreateVideoInput = {
  prompt: string;
  resolution: VideoResolution;
  durationSec: number; // 4-15
  ratio?: string; // 16:9 / 9:16 / 1:1 / adaptive ...
  generateAudio?: boolean; // 2.0 支持有声（含对话/音效/BGM），默认 true
  refImages?: VideoRef[];
};

function authHeaders(extra?: Record<string, string>) {
  return { Authorization: `Bearer ${KEY()}`, ...extra };
}
function vErr(msg: string, status = 502) {
  return Object.assign(new Error(msg), { status });
}

/** 创建视频任务 → 返回 providerTaskId（cgt-xxx）。失败抛错。参数走新方式(body 直传，强校验)。 */
export async function createVideoTask(input: CreateVideoInput): Promise<string> {
  if (!KEY()) throw vErr("未配置 ARK_API_KEY", 500);
  const duration = Math.min(15, Math.max(4, Math.round(input.durationSec)));
  const content: Array<Record<string, unknown>> = [{ type: "text", text: input.prompt }];
  for (const r of input.refImages ?? []) {
    content.push({
      type: "image_url",
      image_url: { url: `data:${r.mime};base64,${r.base64}` },
      role: r.role,
    });
  }
  const res = await fetch(`${BASE}/api/v3/contents/generations/tasks`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      model: MODEL(),
      content,
      resolution: input.resolution,
      ratio: input.ratio ?? "adaptive",
      duration,
      generate_audio: input.generateAudio ?? true,
      watermark: false,
    }),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.id) throw vErr(`创建视频任务失败：${j?.error?.message ?? res.status}`);
  return j.id as string;
}

export type VideoTaskStatus = {
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  videoUrl?: string;
  usageTokens?: number;
  error?: string;
  raw: Record<string, unknown>;
};

/** 查任务状态 */
export async function getVideoTask(providerTaskId: string): Promise<VideoTaskStatus> {
  const res = await fetch(`${BASE}/api/v3/contents/generations/tasks/${providerTaskId}`, {
    headers: authHeaders(),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j) throw vErr(`查询视频任务失败：${res.status}`);
  return {
    status: j.status,
    videoUrl: j.content?.video_url,
    usageTokens: j.usage?.total_tokens ?? j.usage?.completion_tokens,
    error: j.error?.message,
    raw: j,
  };
}
