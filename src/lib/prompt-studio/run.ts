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
  parts.push(`【目标】请为以下条目生成提示词：\n名称：${opts.name}\n描述：${opts.brief}`);
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
