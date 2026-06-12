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
export type ExtractedItem = { kind: string; name: string; brief: string; episodes: number[] };
export type ProjectSpec = {
  tier: ProjectTier;
  aspect: string;
  productionType: string;
  styleGenre: string | null;
};

// 资产条目带 episodes 集数数组后输出大幅变长（111 项×长数组可超 6000 token）→ 截断=提取失败
const EXTRACT_MAX_OUT = 16000;
const GENERATE_MAX_OUT = 4096;
// 静帧是 24 字段导演分解，成品常 8000+ 字符（≈6000+ token）；4096 会截断 → "跑不出来"。
const STILL_MAX_OUT = 10000;

// ===== 提取（提取资产 / 提取分镜，用裸提示词 + JSON，避开结构化输出不稳）=====

/**
 * 宽容 JSON 数组解析：剥代码围栏 → 直接 parse → 失败则截断恢复
 * （Kimi/长输出偶发数组未闭合：砍到最后一个完整对象 "}" 再补 "]" 重试）。
 */
export function parseJsonArrayLoose(text: string): unknown[] | null {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("[");
  if (start === -1) return null;
  const end = t.lastIndexOf("]");
  if (end > start) {
    try {
      const arr = JSON.parse(t.slice(start, end + 1));
      if (Array.isArray(arr)) return arr;
    } catch {
      /* 走截断恢复 */
    }
  }
  // 截断恢复：从尾部往前找完整对象边界逐个尝试
  let body = t.slice(start);
  for (let i = 0; i < 50; i++) {
    const cut = body.lastIndexOf("}");
    if (cut === -1) return null;
    body = body.slice(0, cut + 1);
    try {
      const arr = JSON.parse(body + "]");
      if (Array.isArray(arr) && arr.length > 0) return arr;
    } catch {
      body = body.slice(0, cut); // 这个 "}" 不是对象边界，继续往前
    }
  }
  return null;
}

function extractInstruction(workspace: Workspace, episodeLabel?: string): string {
  if (workspace === "资产") {
    return '通读下面的剧本，提取需要做视觉资产的条目，按类型分类：人物、服装、道具、场景、群演。每条给 kind（五选一）、name（@名，如 @木兰）、brief（一句话外观/身份描述）、episodes（该资产出现的集数数组，按剧本中"第X集"标记判断，如 [1,3,5]；通篇出现可写全部集号）。只输出 JSON 数组，形如 [{"kind":"人物","name":"@木兰","brief":"30岁女将军，英气逼人","episodes":[1,2,3]}]，不要输出任何额外文字、解释或代码块标注。';
  }
  if (workspace === "静帧") {
    return `读下面的${episodeLabel ?? "本集"}剧本，按场景拆出关键帧/分镜镜头列表（一镜一条）。每条给 name（镜头标签，如 镜1）、brief（一句话画面摘要）。只输出 JSON 数组 [{"kind":"静帧","name":"镜1","brief":"破庙外黄昏，木兰持刀对峙刺客"}]，不要任何额外文字。`;
  }
  return `读下面的${episodeLabel ?? "本集"}剧本，拆出需要生成视频的镜头列表（一镜一条）。每条给 name（镜头标签）、brief（一句话动态/运镜/动作摘要）。只输出 JSON 数组 [{"kind":"视频","name":"镜1","brief":"..."}]，不要任何额外文字。`;
}

function parseItems(text: string, workspace: Workspace): ExtractedItem[] {
  const arr = parseJsonArrayLoose(text) as Record<string, unknown>[] | null;
  if (!arr) return [];
  {
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
          episodes: Array.isArray(x.episodes)
            ? [
                ...new Set(
                  (x.episodes as unknown[])
                    .map((n) => Number(n))
                    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 2000)
                ),
              ]
                .sort((a, b) => a - b)
                .slice(0, 500)
            : [],
        };
      })
      .slice(0, 120);
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
  parts.push(
    `【输出格式（硬规则）】只输出可直接粘贴进 image2 的成品提示词正文本身：第一个字就是提示词第一个字。禁止 markdown 标题/加粗/分隔线/引用块，禁止"角色名/设计方向/最终提示词"等字段分解，禁止任何开场白、结尾说明、使用建议。skill 中的开场语/结束语/对话流程仅适用对话场景，此处一律不用。`
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
  if (!text.trim()) throw Object.assign(new Error("模型返回空内容，请重试"), { status: 502 });
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
  shotFunction: string;
  summary: string;
  shotType: string;
  cameraMove: string;
  dialogue: string;
  durationSec: number | null;
  assetRefs: string[];
  needStill: boolean;
};

// 镜头设计 skill 会产出更密的分镜（反应/插入/二次表达），镜数与描述都更多，需更高上限防截断
const SHOTLIST_MAX_OUT = 20000;

/** 台词镜最短时长（秒）：纯台词字数 ÷ 3.5（中文口播 3-4 字/秒）+ 2 秒表演拍。环境音/音效行不算台词。 */
function minDialogueDuration(dialogue: string): number | null {
  const d = dialogue.trim();
  if (!d) return null;
  if (/^(环境音|音效|声音|画外音?[:：]?\s*$|SFX|BGM|无台词|无对白)/.test(d)) return null;
  // 取说话人前缀（"角色（情绪）："）之后的正文；无冒号且不像台词（无引号）→ 视为声音描述
  const m = d.match(/[:：]\s*([\s\S]+)$/);
  const body = m ? m[1] : /[「『"“]/.test(d) ? d : null;
  if (!body) return null;
  const chars = body.replace(/[「」『』""''…—\s.。，,!！?？]/g, "").length;
  if (chars < 2) return null;
  return Math.min(15, Math.ceil(chars / 3.5) + 2);
}

function parseShots(text: string): ExtractedShot[] {
  const arr = parseJsonArrayLoose(text) as Record<string, unknown>[] | null;
  if (!arr) return [];
  {
    return arr
      .filter((x) => x && (typeof x.summary === "string" || typeof x.sceneLabel === "string"))
      .map((x, i) => {
        const dialogue = String(x.dialogue ?? "").slice(0, 300);
        let durationSec = Number.isFinite(Number(x.durationSec))
          ? Math.min(Number(x.durationSec), 60)
          : null;
        // 兜底：台词镜估短了视频像倍速播放——强制不低于口播下限（宁长勿短）
        const minDur = minDialogueDuration(dialogue);
        if (minDur !== null) durationSec = Math.max(durationSec ?? 0, minDur);
        return {
          shotNo: Number.isFinite(Number(x.shotNo)) ? Number(x.shotNo) : i + 1,
          sceneLabel: String(x.sceneLabel ?? "").slice(0, 60),
          shotFunction: String(x.shotFunction ?? "").slice(0, 20),
          summary: String(x.summary ?? "").slice(0, 500),
          shotType: String(x.shotType ?? "").slice(0, 30),
          cameraMove: String(x.cameraMove ?? "").slice(0, 60),
          dialogue,
          durationSec,
          assetRefs: Array.isArray(x.assetRefs)
            ? x.assetRefs.map((a: unknown) => String(a).slice(0, 40)).slice(0, 12)
            : [],
          needStill: typeof x.needStill === "boolean" ? x.needStill : true,
        };
      })
      .slice(0, 200);
  }
}

export async function buildShotlist(opts: {
  userId: string;
  episodeContent: string;
  episodeNo: number;
  spec: ProjectSpec;
  knownAssets: string[]; // 阶段①已提取的资产名，供 assetRefs 对齐
  directorStyle?: string; // 导演风格预设（DIRECTOR_STYLES.md），默认"标准"
}): Promise<{ shots: ExtractedShot[]; credits: number }> {
  const skill = getSkillPrompt("镜头设计"); // 视听语言/découpage：分镜表的大脑
  const note = buildRuntimeNote({
    tier: opts.spec.tier,
    aspect: opts.spec.aspect,
    productionType: opts.spec.productionType,
    styleGenre: opts.spec.styleGenre,
    episode: opts.episodeNo,
  });

  const tier = opts.spec.tier;
  const userText = [
    `【任务】用你 skill 的视听语言/découpage 方法，把下面这一集设计成有电影感的分镜表（不是照剧本平铺、不是台词字幕轨）。你是导演，不是对白记录员。`,
    opts.directorStyle && opts.directorStyle !== "标准"
      ? `【导演风格（用户选定，整集一锁到底）】本集按 skill 风格预设库中的「${opts.directorStyle}」执行：运镜倾向、景别分布、构图语言、节奏、固定/运动比例全部按该预设；summary 里写明每镜的风格执行点（供静帧/视频继承）；预设与通用法则冲突时预设优先，但轴线/视线/反应镜头原则不可破。`
      : ``,
    `【硬要求（务必做到，否则就是 low）】`,
    `1. 每场戏先给一个 master/建立镜交代空间；之后按戏剧节拍 beat 分切，镜头数由 beat 决定，不由台词行数决定。`,
    `2. 对白场景必须有【听者反应镜头】：谁的处境因这句话改变就拍谁——皇上/上位者没说话也要给反应镜头（沉默承载戏）。重磅台词后给反应停留（更长时长），别只拍说话的人。`,
    `3. 运镜要有动机：每个推/拉/摇/移/环绕/手持都为某个情绪或叙事服务；无动机就用固定。但**整场不能全是固定镜头**，情绪高点至少 1 个有动机运镜。`,
    `4. 做视觉二次表达：剧本只写"路人说一句"这种，要扩成"环境→说→听者反应→插入→回应"的小段落（信息不变，只增"怎么拍"）。但禁止改剧情逻辑/人物关系/因果/结局/时代人设。`,
    `5. 善用插入特写（手/信/刀/玉佩/茶盏）、POV 链（看→所见→反应）、纵深调度（前景上位者、后景弱者、遮挡）。相邻镜头景别拉开级差，守 180°轴线与视线匹配。`,
    opts.spec.aspect === "9:16"
      ? `6. 竖屏 9:16：少用横向双人全景，多用过肩/单人近景/纵向分层；大殿戏用纵深消失点构图。`
      : ``,
    `每镜一条 JSON：{"shotNo":序号,"sceneLabel":"场（如 1-1 皇城大街·日·外）","shotFunction":"镜头类型","summary":"画面/动作摘要（含镜头意图，如『反应：皇帝眼神由疑转杀』）","shotType":"景别","cameraMove":"运镜","dialogue":"台词或声音（无对白写环境音/留空）","durationSec":预估秒数或null,"assetRefs":["@资产名"...],"needStill":是否值得出静帧}`,
    `shotFunction 用规范镜头类型词（审核镜头衔接逻辑用）：建立/主镜/对话/反应/插入/空镜/POV/转场/动作/蒙太奇。`,
    `shotType 用规范景别词：远景/全景/中景/中近景/近景/特写/大特写/微距。cameraMove 写具体运镜（固定/手持呼吸/缓慢推近/拉远/横移/摇/升降/环绕/俯拍冻结/同轴猛推等），禁写 zoom。`,
    `durationSec（⚠️宁长勿短，估短了视频会像倍速播放）：有台词的镜 = 纯台词字数 ÷ 3.5（中文口播约 3-4 字/秒）+ 2 秒表演拍，向上取整（例：14 字台词 ≈ 6 秒，30 字 ≈ 11 秒）；闪现建立 1 秒内；无台词反应（带情绪弧）5-10；插入/空镜 1-2；情绪特写完整弧 8-15。单镜不超过 15 秒。`,
    `needStill（是否值得出静帧图作强控锚）：${tier === "B" ? "B 级跑量剧——只给复杂构图/多人/难控动作/关键情绪/会被反复参考的镜标 true，其余 false（直接进视频）" : `${tier} 级精品——构图复杂或关键情绪镜标 true，简单过场标 false`}。`,
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

/** 按用户修改建议修订现有分镜表（底部对话工具）：全表输出，未涉及的镜原样保留 */
export async function refineShotlist(opts: {
  userId: string;
  currentShots: ExtractedShot[];
  suggestion: string;
  episodeNo: number;
  spec: ProjectSpec;
  directorStyle?: string;
}): Promise<{ shots: ExtractedShot[]; credits: number }> {
  const skill = getSkillPrompt("镜头设计");
  const note = buildRuntimeNote({
    tier: opts.spec.tier,
    aspect: opts.spec.aspect,
    productionType: opts.spec.productionType,
    styleGenre: opts.spec.styleGenre,
    episode: opts.episodeNo,
  });
  const userText = [
    `【任务】按用户的修改建议修订下面的分镜表（用你 skill 的视听语言法则执行）。`,
    `【用户修改建议】${opts.suggestion}`,
    opts.directorStyle && opts.directorStyle !== "标准"
      ? `【导演风格】本集按「${opts.directorStyle}」预设，修订须保持风格一致。`
      : ``,
    `【规则】1. 输出修订后的**完整分镜表**（全表 JSON，与原表同构字段：shotNo/sceneLabel/shotFunction/summary/shotType/cameraMove/dialogue/durationSec/assetRefs/needStill）。2. 建议未涉及的镜**原样保留**（字段一字不改）。3. 可增/删/改镜，镜号重排为连续序号。4. 台词镜时长=纯台词字数÷3.5+2 秒，宁长勿短。5. 只输出 JSON 数组，不要任何额外文字。`,
    note,
    `----- 当前分镜表 -----`,
    JSON.stringify(opts.currentShots),
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
    ref: { appKey: "prompt-studio", note: `修订分镜表-第${opts.episodeNo}集` },
  });
  return { shots: parseShots(text), credits };
}

// ===== 阶段③/④：逐镜生成静帧 / 视频提示词 =====

export type ShotInfo = {
  shotNo: number;
  sceneLabel: string;
  shotFunction?: string;
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

// ===== 阶段④：视频片段（多镜合并）——划分片段 + 逐片段生成 =====

export type PlannedSegment = {
  segmentNo: number;
  label: string;
  shotNos: number[];
  durationSec: number | null;
};

const PLAN_MAX_OUT = 4000;
const SEGMENT_MAX_OUT = 5000;

function shotTableText(shots: ShotInfo[]): string {
  return shots
    .map(
      (s) =>
        `镜${s.shotNo}｜${s.sceneLabel}｜${s.shotType}/${s.cameraMove}｜${s.durationSec ?? "?"}s｜${s.summary}${s.dialogue ? `｜台词:${s.dialogue}` : ""}`
    )
    .join("\n");
}

/** 把整集分镜表按 skill 的片段划分规则（同场/同角色组/情绪连续/≤15s）分组 */
export async function planSegments(opts: {
  userId: string;
  shots: ShotInfo[];
  episodeNo: number;
  spec: ProjectSpec;
}): Promise<{ segments: PlannedSegment[]; credits: number }> {
  const skill = getSkillPrompt("视频");
  const note = buildRuntimeNote({
    tier: opts.spec.tier,
    aspect: opts.spec.aspect,
    productionType: opts.spec.productionType,
    styleGenre: opts.spec.styleGenre,
    episode: opts.episodeNo,
  });
  const userText = [
    `【任务】只做"片段划分"这一步，不写提示词：按 skill 的片段划分规则（同场景、同角色组、情绪/时间连续的相邻镜合并；跨场景硬切/角色组改变才拆分；文延武拼），把下面整集分镜表分组。`,
    `【时长规则（最高优先级，违反=废稿）】每片段时长 = 成员镜 durationSec 的**实际加总**（分镜表里已给出每镜秒数，必须照实累加，不许拍脑袋写 15）。目标区间 **13-15 秒**，硬上限 15 秒——加总超 15 就必须拆开。不必死磕 15：同场戏装到 10 秒、下一镜 7 秒装不下，就让本片段停在 10 秒。`,
    `【剪辑点重叠（可选技巧）】片段没装满（如 10 秒）且下一镜较长装不下时，可以把下一镜**同时**作为本片段的尾镜和下一片段的首镜（镜号在两个相邻片段中重复出现）——重叠部分方便剪辑找切点。`,
    `【打满原则】在时长规则允许内尽量装满：同场景相邻镜持续合并到再加一镜会超 15 秒为止；插镜/反应镜并入所在片段，不单独成段；禁止把同场连续的戏拆成一堆小片段。`,
    `每片段一条 JSON：{"segmentNo":序号,"label":"一句话标签（如 破庙对峙·拔刀缠斗）","shotNos":[相邻镜号],"durationSec":成员镜秒数实际加总}`,
    `镜号必须全部覆盖、保持原顺序相邻分组（仅相邻片段边界镜可重复）。只输出 JSON 数组，不要任何额外文字。`,
    note,
    `----- 第 ${opts.episodeNo} 集分镜表 -----`,
    shotTableText(opts.shots),
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
  const est = await estimateLlmMaxCredits(MODEL_MAIN(), skill.length + userText.length, PLAN_MAX_OUT);
  await precheck(opts.userId, est);

  const { text, usage, providerMetadata } = await generateText({
    model: mainModel(),
    messages,
    maxOutputTokens: PLAN_MAX_OUT,
    providerOptions: { anthropic: { metadata: { userId: opts.userId } } },
  });
  const { credits } = await chargeLlm({
    userId: opts.userId,
    model: MODEL_MAIN(),
    usage: toLlmUsage(usage, providerMetadata as Record<string, Record<string, unknown>> | undefined),
    ref: { appKey: "prompt-studio", note: `划分片段-第${opts.episodeNo}集` },
  });

  // 解析 + 防御：镜号去重、片段重编号（宽容解析兜截断）
  const parsedArr = parseJsonArrayLoose(text) as Record<string, unknown>[] | null;
  let segments: PlannedSegment[] = [];
  if (parsedArr) {
    {
      {
        const arr = parsedArr;
        segments = arr
          .filter((x) => x && Array.isArray(x.shotNos) && x.shotNos.length > 0)
          .map((x, i) => ({
            segmentNo: i + 1,
            label: String(x.label ?? "").slice(0, 60),
            // 片段内去重；允许相邻片段共享边界镜（剪辑点重叠是用户要的特性）
            shotNos: [
              ...new Set(
                (x.shotNos as unknown[]).map((n) => Number(n)).filter((n) => Number.isFinite(n))
              ),
            ],
            durationSec: null, // 一律不信 LLM 标称，下面按分镜表实际加总重算
          }))
          .filter((s) => s.shotNos.length > 0)
          .slice(0, 80);
      }
    }
  }

  // ===== 确定性后处理（不依赖模型自觉）。时长一律 = 成员镜 durationSec 实际加总 =====
  const shotByNo = new Map(opts.shots.map((s) => [s.shotNo, s]));
  const durOf = (no: number) => shotByNo.get(no)?.durationSec ?? 3; // 缺时长按 3s 保守估
  const sumOf = (nos: number[]) => nos.reduce((s, n) => s + durOf(n), 0);
  const sceneOf = (nos: number[]): string | null => {
    const labels = new Set(nos.map((n) => shotByNo.get(n)?.sceneLabel.trim() ?? `?${n}`));
    return labels.size === 1 ? [...labels][0] : null;
  };

  // 1) 超 15s 的片段装箱拆分：按镜序累加，加下一镜会超 15 就切断（单镜超 15 自成一段）
  const packed: PlannedSegment[] = [];
  for (const seg of segments) {
    if (sumOf(seg.shotNos) <= 15) {
      packed.push(seg);
      continue;
    }
    let bin: number[] = [];
    let part = 0;
    for (const no of seg.shotNos) {
      if (bin.length > 0 && sumOf(bin) + durOf(no) > 15) {
        part++;
        packed.push({
          segmentNo: 0,
          label: part === 1 ? seg.label : `${seg.label}·续${part - 1}`.slice(0, 60),
          shotNos: bin,
          durationSec: null,
        });
        bin = [];
      }
      bin.push(no);
    }
    if (bin.length) {
      part++;
      packed.push({
        segmentNo: 0,
        label: part === 1 ? seg.label : `${seg.label}·续${part - 1}`.slice(0, 60),
        shotNos: bin,
        durationSec: null,
      });
    }
  }
  segments = packed;

  // 2) 打满合并兜底：相邻片段同场景且实际加总 ≤15s → 合并，循环到不动点
  let mergedAny = true;
  while (mergedAny) {
    mergedAny = false;
    for (let i = 0; i + 1 < segments.length; i++) {
      const a = segments[i];
      const b = segments[i + 1];
      const sa = sceneOf(a.shotNos);
      const sb = sceneOf(b.shotNos);
      // 合并时边界重叠镜只算一次
      const mergedNos = [...new Set([...a.shotNos, ...b.shotNos])].sort((x, y) => x - y);
      if (sa !== null && sa === sb && sumOf(mergedNos) <= 15) {
        segments.splice(i, 2, {
          segmentNo: 0,
          label: `${a.label}·${b.label}`.slice(0, 60),
          shotNos: mergedNos,
          durationSec: null,
        });
        mergedAny = true;
        break;
      }
    }
  }

  // 3) 重编号 + 写实际时长
  segments.forEach((s, i) => {
    s.segmentNo = i + 1;
    s.durationSec = Math.min(sumOf(s.shotNos), 15);
  });

  return { segments, credits };
}

/** 为一个片段（若干相邻镜）生成一条多镜合并的 Seedance 视频提示词 */
export async function generateSegmentPrompt(opts: {
  userId: string;
  segment: PlannedSegment;
  shots: ShotInfo[]; // 本片段的成员镜（按镜号序）
  stillPrompts: { shotNo: number; prompt: string }[]; // 成员镜已有的静帧提示词（构图锚）
  episodeContent?: string;
  assetBriefs?: { name: string; brief: string }[];
  spec: ProjectSpec;
  directorStyle?: string; // 本集分镜表选定的导演风格（运镜执行随之）
  refine?: string;
}): Promise<{ promptText: string; credits: number; usage: LlmUsage }> {
  const skill = getSkillPrompt("视频");
  const note = buildRuntimeNote({
    tier: opts.spec.tier,
    aspect: opts.spec.aspect,
    productionType: opts.spec.productionType,
    styleGenre: opts.spec.styleGenre,
    episode: opts.shots[0]?.episodeNo,
  });

  const parts: string[] = [];
  if (opts.episodeContent) {
    parts.push(`【本集剧本（背景参考）】\n${opts.episodeContent.slice(0, 40000)}`);
  }
  parts.push(
    `【本片段（来自已确认的分镜表）】片段 ${opts.segment.segmentNo}：${opts.segment.label}\n目标总时长：${opts.segment.durationSec ?? 15} 秒（≤15）\n成员镜：\n${shotTableText(opts.shots)}`
  );
  if (opts.assetBriefs?.length) {
    parts.push(
      `【关联资产档案（@名与外观必须一致）】\n${opts.assetBriefs.map((a) => `${a.name}：${a.brief}`).join("\n")}`
    );
  }
  if (opts.stillPrompts.length) {
    parts.push(
      `【成员镜静帧提示词（构图/光影锚参考）】\n${opts.stillPrompts
        .map((s) => `镜${s.shotNo}：\n${s.prompt.slice(0, 3000)}`)
        .join("\n\n")}`
    );
  }
  parts.push(
    [
      `【任务】为本片段生成**一条**多镜合并的 Seedance 2.0 视频提示词（不是逐镜各一条）。严格按 skill 的 11 节结构序依次写，不跳不乱：`,
      `1. @handle 声明：@image1 起逐条重编，**只标资产是什么，不写外观描述**（外观由参考图锁定，写了浪费字数）——格式如「@image1=杨延昭（战损血污状态）」「@image2=汴京街市场景图」「@image3=镜3静帧（构图/光影锚）」；仅状态词（战损/湿发/换装）需要标注，脸型服装细节一概不写。`,
      `2. 通用警告：⚠️空间布局（MAIN VIEW/位置/米数/朝向/遮挡/视线锁定）／⚠️对白规则：一句台词=一个镜头，每句写明对谁说／⚠️本视频严格只有 ${opts.shots.length} 个镜头——禁止添加额外镜头。`,
      `3. 【镜头N】块逐镜写（成员镜一一对应）：机位（焦段mm+光圈+景别+手持/static/dolly）／摄影机运动（绑焦点角色情绪，一镜一动）／背景／动作（分步①②③，小幅动作+承接余势）／⚠️⚠️⚠️微表演细节（肌肉/呼吸/眼神/皮肤，禁抽象情绪词；台词带 pre/mid/post 三拍）。闪现镜标 0.3-0.5 秒并写硬切。`,
      `4. 风格块：practicals-only（只用实景光，禁一切电影补光，摄影机在阴影侧，60:30:10 配色）。`,
      `5. 环境活动：人群场景写背景具体在干什么（禁空旷背景）；空寂场景写寂静本身+环境 SFX。`,
      `6. 失败模式 ⚠️ 防御 + 标准禁块（禁3D渲染/禁补光/禁god rays/禁畸变/禁漂浮道具/禁身份漂移/禁zoom/禁音乐/禁字幕/禁水印…按本片段崩点取用）。`,
      `7. 收尾 footer：质量锚定语（面部稳定不变形、五官清晰、人体结构正常、动作自然流畅、不僵硬、画面无卡顿、无闪烁）+「无水印、无字幕。${opts.segment.durationSec ?? 15}秒。<项目画幅>。」`,
      `【字数预算（硬限）】全文 ≤3000 字符、纯中文、台词用剧本原文。复杂反应镜该长就长（微操表演是质量来源），但超预算时按此序压缩：背景描述 → 重复的禁则（合并成一组）→ handle 里参考图已锁的纯外观细节——**绝不压缩微表演与空间布局**。只输出提示词本身，不输出任何解释或检查表。`,
    ].join("\n")
  );
  if (opts.directorStyle && opts.directorStyle !== "标准") {
    parts.push(
      `【导演风格】本集分镜按「${opts.directorStyle}」风格设计，运镜执行、构图语言、光色倾向须与之一致（分镜表 summary 里已写明各镜风格执行点，照做不改）。`
    );
  }
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
  const est = await estimateLlmMaxCredits(MODEL_MAIN(), skill.length + userText.length, SEGMENT_MAX_OUT);
  await precheck(opts.userId, est);

  const { text, usage, providerMetadata } = await generateText({
    model: mainModel(),
    messages,
    maxOutputTokens: SEGMENT_MAX_OUT,
    providerOptions: { anthropic: { metadata: { userId: opts.userId } } },
  });
  if (!text.trim()) throw Object.assign(new Error("模型返回空内容，请重试"), { status: 502 });
  const u = toLlmUsage(usage, providerMetadata as Record<string, Record<string, unknown>> | undefined);
  const { credits } = await chargeLlm({
    userId: opts.userId,
    model: MODEL_MAIN(),
    usage: u,
    ref: {
      appKey: "prompt-studio",
      note: `视频片段-第${opts.shots[0]?.episodeNo}集片段${opts.segment.segmentNo}`,
    },
  });
  return { promptText: text.trim(), credits, usage: u };
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
  directorStyle?: string; // 本集分镜表选定的导演风格（构图/色彩随之）
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
  if (opts.directorStyle && opts.directorStyle !== "标准") {
    parts.push(
      `【导演风格】本集分镜按「${opts.directorStyle}」风格设计，构图语言、色彩光线倾向、机位选择须与之一致（分镜表 summary 已写明本镜风格执行点，照做不改）。`
    );
  }
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
  // 静帧 24 字段成品常 8000+ 字符，需更高输出上限，否则被截断 → "跑不出来"
  const maxOut = opts.target === "still" ? STILL_MAX_OUT : GENERATE_MAX_OUT;
  const est = await estimateLlmMaxCredits(MODEL_MAIN(), skill.length + userText.length, maxOut);
  await precheck(opts.userId, est);

  const { text, usage, providerMetadata } = await generateText({
    model: mainModel(),
    messages,
    maxOutputTokens: maxOut,
    providerOptions: { anthropic: { metadata: { userId: opts.userId } } },
  });
  if (!text.trim()) throw Object.assign(new Error("模型返回空内容，请重试"), { status: 502 });
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
