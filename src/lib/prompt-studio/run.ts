import { generateText, type ModelMessage } from "ai";
import { mainModel, MODEL_MAIN, toLlmUsage } from "../ai/llm";
import { getSkillPrompt, buildRuntimeNote, type SkillKey } from "../ai/skills";
import { chargeLlm, precheck, estimateLlmMaxCredits, type LlmUsage } from "../billing/charge";
import type { ProjectTier } from "../db/schema";

/**
 * 提示词生成器的非对话生产逻辑（参考 Toonflow「提取 → 逐项生成」卡片模型）。
 * 提取 = 把剧本/集拆成条目列表（资产/镜头）；生成 = 每条用对应 skill 出提示词。
 */

export type Workspace = "资产" | "静帧" | "视频";
export type ExtractedItem = { kind: string; name: string; brief: string };
export type ProjectSpec = {
  tier: ProjectTier;
  aspect: string;
  productionType: string;
  styleGenre: string | null;
};

const EXTRACT_MAX_OUT = 6000;
const GENERATE_MAX_OUT = 4096;

// ===== 提取（提取资产 / 提取分镜，用裸提示词 + JSON，避开乐奇结构化输出不稳）=====

function extractInstruction(workspace: Workspace, episodeLabel?: string): string {
  if (workspace === "资产") {
    return '通读下面的剧本，提取需要做视觉资产的条目，按类型分类：人物、服装、道具、场景、群演。每条给 kind（五选一）、name（@名，如 @木兰）、brief（一句话外观/身份描述）。只输出 JSON 数组，形如 [{"kind":"人物","name":"@木兰","brief":"30岁女将军，英气逼人"}]，不要输出任何额外文字、解释或代码块标注。';
  }
  if (workspace === "静帧") {
    return `读下面的${episodeLabel ?? "本集"}剧本，按场景拆出关键帧/分镜镜头列表（一镜一条）。每条给 name（镜头标签，如 镜1）、brief（一句话画面摘要）。只输出 JSON 数组 [{"kind":"静帧","name":"镜1","brief":"破庙外黄昏，木兰持刀对峙刺客"}]，不要任何额外文字。`;
  }
  return `读下面的${episodeLabel ?? "本集"}剧本，拆出需要生成视频的镜头列表（一镜一条）。每条给 name（镜头标签）、brief（一句话动态/运镜/动作摘要）。只输出 JSON 数组 [{"kind":"视频","name":"镜1","brief":"..."}]，不要任何额外文字。`;
}

function parseItems(text: string, workspace: Workspace): ExtractedItem[] {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("[");
  const end = t.lastIndexOf("]");
  if (start === -1 || end === -1) return [];
  try {
    const arr = JSON.parse(t.slice(start, end + 1));
    if (!Array.isArray(arr)) return [];
    const validKinds = ["人物", "服装", "道具", "场景", "群演"];
    return arr
      .filter((x) => x && typeof x.name === "string" && x.name.trim())
      .map((x) => {
        let kind = typeof x.kind === "string" ? x.kind.trim() : "";
        if (workspace === "资产") {
          if (!validKinds.includes(kind)) kind = "道具";
        } else {
          kind = workspace;
        }
        return {
          kind,
          name: String(x.name).trim().slice(0, 80),
          brief: typeof x.brief === "string" ? x.brief.trim().slice(0, 300) : "",
        };
      })
      .slice(0, 120);
  } catch {
    return [];
  }
}

export async function extractItems(opts: {
  userId: string;
  workspace: Workspace;
  scriptText: string;
  episodeLabel?: string;
}): Promise<{ items: ExtractedItem[]; credits: number }> {
  const prompt = `${extractInstruction(opts.workspace, opts.episodeLabel)}\n\n----- 剧本 -----\n${opts.scriptText.slice(0, 200000)}`;
  const est = await estimateLlmMaxCredits(MODEL_MAIN(), prompt.length, EXTRACT_MAX_OUT);
  await precheck(opts.userId, est);

  const { text, usage, providerMetadata } = await generateText({
    model: mainModel(),
    prompt,
    maxOutputTokens: EXTRACT_MAX_OUT,
    providerOptions: { anthropic: { metadata: { userId: opts.userId } } },
  });
  const { credits } = await chargeLlm({
    userId: opts.userId,
    model: MODEL_MAIN(),
    usage: toLlmUsage(usage, providerMetadata as Record<string, Record<string, unknown>> | undefined),
    ref: { appKey: "prompt-studio", note: `提取-${opts.workspace}` },
  });
  return { items: parseItems(text, opts.workspace), credits };
}

// ===== 单条生成（用对应 skill 出提示词）=====

// 各资产 skill 的核心硬约束，提到任务层显式重申（防止被简化目标带偏）
const KIND_CONSTRAINTS: Record<string, string> = {
  人物: "只写面部特征、骨相、毛发、年龄、人种；禁止表情/情绪/服装/道具/头饰/场景/动作（定妆照属性）。",
  服装: "用无脸假人模特（faceless mannequin）展示，不出现真人脸与表情。",
  道具: "只描述器物本身（档案图属性）；不出现真人、表情、剧情动作。",
  场景: "空景/氛围图，默认不含主要人物。",
  群演: "真人选角板风格，全部为真人演员。",
};

export async function generateItemPrompt(opts: {
  userId: string;
  kind: string; // SkillKey：人物|服装|道具|场景|群演|静帧|视频
  name: string;
  brief: string;
  episodeContent?: string;
  spec: ProjectSpec;
  refine?: string;
}): Promise<{ promptText: string; credits: number; usage: LlmUsage }> {
  const skill = getSkillPrompt(opts.kind as SkillKey);
  const note = buildRuntimeNote({
    tier: opts.spec.tier,
    aspect: opts.spec.aspect,
    productionType: opts.spec.productionType,
    styleGenre: opts.spec.styleGenre,
  });

  const parts: string[] = [];
  if (opts.episodeContent) parts.push(`【本集剧本（背景参考）】\n${opts.episodeContent.slice(0, 60000)}`);
  const constraint = KIND_CONSTRAINTS[opts.kind];
  parts.push(
    `【目标】请为以下条目生成提示词：\n名称：${opts.name}\n描述：${opts.brief}${constraint ? `\n【硬约束（按 skill）】${constraint}` : ""}`
  );
  if (opts.refine) parts.push(`【额外要求】${opts.refine}`);
  if (note) parts.push(note);
  const userText = parts.join("\n\n");

  const messages: ModelMessage[] = [
    {
      role: "system",
      content: skill,
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
    },
    { role: "user", content: userText },
  ];

  const est = await estimateLlmMaxCredits(MODEL_MAIN(), skill.length + userText.length, GENERATE_MAX_OUT);
  await precheck(opts.userId, est);

  const { text, usage, providerMetadata } = await generateText({
    model: mainModel(),
    messages,
    maxOutputTokens: GENERATE_MAX_OUT,
    providerOptions: { anthropic: { metadata: { userId: opts.userId } } },
  });
  const u = toLlmUsage(usage, providerMetadata as Record<string, Record<string, unknown>> | undefined);
  const { credits } = await chargeLlm({
    userId: opts.userId,
    model: MODEL_MAIN(),
    usage: u,
    ref: { appKey: "prompt-studio", note: `生成-${opts.kind}`, name: opts.name },
  });
  return { promptText: text.trim(), credits, usage: u };
}

/** 产物类型映射（存为产物时用） */
export function artifactTypeFor(workspace: Workspace): string {
  return workspace === "资产" ? "资产提示词" : workspace === "静帧" ? "静帧提示词" : "视频提示词";
}

// ===== 阶段②：构建分镜表（shotlist）——内嵌分镜大师的「关键帧筛选与合并」规则 =====

export type ExtractedShot = {
  shotNo: number;
  sceneLabel: string;
  summary: string;
  shotType: string;
  cameraMove: string;
  dialogue: string;
  durationSec: number | null;
  assetRefs: string[];
  needStill: boolean;
};

const SHOTLIST_MAX_OUT = 12000;

function parseShots(text: string): ExtractedShot[] {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("[");
  const end = t.lastIndexOf("]");
  if (start === -1 || end === -1) return [];
  try {
    const arr = JSON.parse(t.slice(start, end + 1));
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => x && (typeof x.summary === "string" || typeof x.sceneLabel === "string"))
      .map((x, i) => ({
        shotNo: Number.isFinite(Number(x.shotNo)) ? Number(x.shotNo) : i + 1,
        sceneLabel: String(x.sceneLabel ?? "").slice(0, 60),
        summary: String(x.summary ?? "").slice(0, 500),
        shotType: String(x.shotType ?? "").slice(0, 30),
        cameraMove: String(x.cameraMove ?? "").slice(0, 60),
        dialogue: String(x.dialogue ?? "").slice(0, 300),
        durationSec: Number.isFinite(Number(x.durationSec)) ? Math.min(Number(x.durationSec), 60) : null,
        assetRefs: Array.isArray(x.assetRefs)
          ? x.assetRefs.map((a: unknown) => String(a).slice(0, 40)).slice(0, 12)
          : [],
        needStill: typeof x.needStill === "boolean" ? x.needStill : true,
      }))
      .slice(0, 200);
  } catch {
    return [];
  }
}

export async function buildShotlist(opts: {
  userId: string;
  episodeContent: string;
  episodeNo: number;
  spec: ProjectSpec;
  knownAssets: string[]; // 阶段①已提取的资产名，供 assetRefs 对齐
}): Promise<{ shots: ExtractedShot[]; credits: number }> {
  const skill = getSkillPrompt("静帧"); // 分镜大师：关键帧筛选/合并/分级取舍规则都在 skill 里
  const note = buildRuntimeNote({
    tier: opts.spec.tier,
    aspect: opts.spec.aspect,
    productionType: opts.spec.productionType,
    styleGenre: opts.spec.styleGenre,
    episode: opts.episodeNo,
  });

  const userText = [
    `【任务】只做分镜表（shotlist）构建这一步，不写静帧提示词：按你 skill 中「关键帧筛选与合并」的规则，把下面这一集拆成镜头列表。`,
    `每镜一条 JSON：{"shotNo":序号,"sceneLabel":"场（如 3-1 破庙外·黄昏）","summary":"画面/动作摘要","shotType":"景别","cameraMove":"运镜","dialogue":"台词或声音（无则空串）","durationSec":预估秒数或null,"assetRefs":["@资产名"...],"needStill":是否值得出静帧}`,
    `needStill 按 skill 的静帧取舍分级规则判断（当前项目分级见下方项目设定）。`,
    opts.knownAssets.length
      ? `assetRefs 里的资产名尽量对齐项目已建档资产：${opts.knownAssets.join("、")}（出现了清单外的重要资产也可以写新 @名）。`
      : `assetRefs 写画面中出现的关键人物/道具/场景的 @名。`,
    `只输出 JSON 数组，不要任何额外文字或代码块标注。`,
    note,
    `----- 第 ${opts.episodeNo} 集剧本 -----`,
    opts.episodeContent.slice(0, 100000),
  ]
    .filter(Boolean)
    .join("\n\n");

  const messages: ModelMessage[] = [
    {
      role: "system",
      content: skill,
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
    },
    { role: "user", content: userText },
  ];
  const est = await estimateLlmMaxCredits(MODEL_MAIN(), skill.length + userText.length, SHOTLIST_MAX_OUT);
  await precheck(opts.userId, est);

  const { text, usage, providerMetadata } = await generateText({
    model: mainModel(),
    messages,
    maxOutputTokens: SHOTLIST_MAX_OUT,
    providerOptions: { anthropic: { metadata: { userId: opts.userId } } },
  });
  const { credits } = await chargeLlm({
    userId: opts.userId,
    model: MODEL_MAIN(),
    usage: toLlmUsage(usage, providerMetadata as Record<string, Record<string, unknown>> | undefined),
    ref: { appKey: "prompt-studio", note: `构建分镜表-第${opts.episodeNo}集` },
  });
  return { shots: parseShots(text), credits };
}

// ===== 阶段③/④：逐镜生成静帧 / 视频提示词 =====

export type ShotInfo = {
  shotNo: number;
  sceneLabel: string;
  summary: string;
  shotType: string;
  cameraMove: string;
  dialogue: string;
  durationSec: number | null;
  assetRefs: string[];
  episodeNo: number;
  needStill: boolean;
};

function shotBrief(shot: ShotInfo): string {
  const lines = [
    `镜号：${shot.shotNo}`,
    shot.sceneLabel && `场：${shot.sceneLabel}`,
    `画面：${shot.summary}`,
    shot.shotType && `景别：${shot.shotType}`,
    shot.cameraMove && `运镜：${shot.cameraMove}`,
    shot.dialogue && `台词/声音：${shot.dialogue}`,
    shot.durationSec ? `预估时长：${shot.durationSec} 秒` : "",
    shot.assetRefs.length ? `关联资产：${shot.assetRefs.join("、")}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

export async function generateShotPrompt(opts: {
  userId: string;
  target: "still" | "video";
  shot: ShotInfo;
  episodeContent?: string;
  /** 关联资产档案（名称+描述），让提示词与资产建档对齐 */
  assetBriefs?: { name: string; brief: string }[];
  /** 已生成的静帧提示词（视频阶段作画面锚参考） */
  stillPrompt?: string | null;
  spec: ProjectSpec;
  refine?: string;
}): Promise<{ promptText: string; credits: number; usage: LlmUsage }> {
  const skillKey = opts.target === "still" ? "静帧" : "视频";
  const skill = getSkillPrompt(skillKey);
  const note = buildRuntimeNote({
    tier: opts.spec.tier,
    aspect: opts.spec.aspect,
    productionType: opts.spec.productionType,
    styleGenre: opts.spec.styleGenre,
    episode: opts.shot.episodeNo,
  });

  const parts: string[] = [];
  if (opts.episodeContent) {
    parts.push(`【本集剧本（背景参考，理解上下文用）】\n${opts.episodeContent.slice(0, 50000)}`);
  }
  parts.push(`【本镜信息（来自已确认的分镜表）】\n${shotBrief(opts.shot)}`);
  if (opts.assetBriefs?.length) {
    parts.push(
      `【关联资产档案（@名与外观必须与之一致）】\n${opts.assetBriefs
        .map((a) => `${a.name}：${a.brief}`)
        .join("\n")}`
    );
  }
  if (opts.target === "video" && opts.stillPrompt) {
    parts.push(`【本镜静帧提示词（已生成，作为构图/光影/blocking 锚参考）】\n${opts.stillPrompt}`);
  }
  parts.push(
    opts.target === "still"
      ? [
          `【任务】只为这一镜生成关键帧静帧提示词：按 skill 输出 24 字段导演分解 + 末尾一段可直接喂 image2 的成品提示词。`,
          `【静帧取舍】本镜在分镜表中标记 needStill=${opts.shot.needStill}（取舍依据见 skill 的分级规则）。`,
          opts.shot.needStill
            ? `本镜已确认需要静帧，请完整生成。`
            : `本镜原标记为可跳过静帧，但用户主动要求生成——仍按 skill 完整生成，并在开头用一行说明该镜按分级本可直进视频。`,
        ].join("\n")
      : [
          `【任务】只为这一镜生成 Seedance 2.0 视频提示词。严格遵守 skill 的硬规则：`,
          `1. 骨架按项目分级一锁到底：S/A 级=影视级分镜块骨架；B 级=八要素公式骨架，不做单镜覆盖。`,
          `2. 开头写【资产声明块】：@image1=静帧（若有，作构图/光影/blocking 锚）、@image2 起=关联资产母版，handle 顺序固定。多图参考≠首帧逻辑。`,
          `3. 必须写【空间布局块】（米数/朝向/谁遮谁/视线锁定），不能指望参考图锁空间。`,
          `4. 人物出镜句末必加质量锚定语；遵守禁清单（禁配乐/字幕/水印、禁反射镜头叙事）。`,
          `5. 单条 ≤15 秒、≤3000 字符、纯中文。`,
        ].join("\n")
  );
  if (opts.refine) parts.push(`【额外要求】${opts.refine}`);
  if (note) parts.push(note);
  const userText = parts.join("\n\n");

  const messages: ModelMessage[] = [
    {
      role: "system",
      content: skill,
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
    },
    { role: "user", content: userText },
  ];
  const est = await estimateLlmMaxCredits(MODEL_MAIN(), skill.length + userText.length, GENERATE_MAX_OUT);
  await precheck(opts.userId, est);

  const { text, usage, providerMetadata } = await generateText({
    model: mainModel(),
    messages,
    maxOutputTokens: GENERATE_MAX_OUT,
    providerOptions: { anthropic: { metadata: { userId: opts.userId } } },
  });
  const u = toLlmUsage(usage, providerMetadata as Record<string, Record<string, unknown>> | undefined);
  const { credits } = await chargeLlm({
    userId: opts.userId,
    model: MODEL_MAIN(),
    usage: u,
    ref: {
      appKey: "prompt-studio",
      note: `${opts.target === "still" ? "静帧" : "视频"}-第${opts.shot.episodeNo}集镜${opts.shot.shotNo}`,
    },
  });
  return { promptText: text.trim(), credits, usage: u };
}
