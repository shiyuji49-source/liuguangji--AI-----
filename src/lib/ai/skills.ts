import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import type { ProjectTier } from "../db/schema";

/**
 * skill → 系统提示词（规划书 §7）。
 * 启动时把 docs/鎏光智绘提示词SKILL/ 的 SKILL.md（+RUNTIME.md）+ references 全量拼接并缓存；
 * 禁止改写 skill 内容；换 skill = 换文件重启。
 */
export type SkillKey =
  | "script-doctor"
  | "人物"
  | "服装"
  | "道具"
  | "场景"
  | "群演"
  | "静帧"
  | "视频";

const SKILL_ROOT = path.join(process.cwd(), "docs", "鎏光智绘提示词SKILL");

const SOURCES: Record<SkillKey, { dir?: string; file?: string }> = {
  "script-doctor": { dir: "script-revision" },
  人物: { file: "人物提示词SKILL.md" },
  服装: { file: "服装提示词SKILL.md" },
  道具: { file: "道具提示词SKILL.md" },
  群演: { file: "群演提示词SKILL.md" },
  场景: { dir: "scene-prompt-generator" },
  静帧: { dir: "storyboard-master" },
  视频: { dir: "seedance-video-prompt" },
};

const cache = new Map<SkillKey, string>();

function loadDirSkill(dir: string): string {
  const root = path.join(SKILL_ROOT, dir);
  const parts: string[] = [];
  for (const name of ["SKILL.md", "RUNTIME.md"]) {
    const p = path.join(root, name);
    if (existsSync(p)) parts.push(readFileSync(p, "utf8"));
  }
  const refDir = path.join(root, "references");
  if (existsSync(refDir)) {
    for (const f of readdirSync(refDir).sort()) {
      if (!f.endsWith(".md")) continue;
      parts.push(`\n---\n\n<!-- reference: ${f} -->\n\n${readFileSync(path.join(refDir, f), "utf8")}`);
    }
  }
  return parts.join("\n\n");
}

export function getSkillPrompt(key: SkillKey): string {
  const hit = cache.get(key);
  if (hit) return hit;
  const src = SOURCES[key];
  const text = src.dir
    ? loadDirSkill(src.dir)
    : readFileSync(path.join(SKILL_ROOT, src.file!), "utf8");
  if (!text.trim()) throw new Error(`skill 文件为空：${key}`);
  cache.set(key, text);
  return text;
}

/** 运行时附注（独立小块注入，不并入 skill 块，保持缓存命中稳定） */
export function buildRuntimeNote(opts: {
  tier?: ProjectTier;
  aspect?: string;
  episode?: number | string;
}): string {
  const lines: string[] = [];
  if (opts.tier) lines.push(`【项目分级】${opts.tier} 级`);
  if (opts.aspect) lines.push(`【画幅】${opts.aspect}`);
  if (opts.episode !== undefined && opts.episode !== null && `${opts.episode}` !== "") {
    lines.push(`【当前集】第 ${opts.episode} 集`);
  }
  return lines.join("\n");
}
