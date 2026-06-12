import type { ProjectRole } from "@/lib/db/schema";

/**
 * 应用注册表（产品铁律 1：平台=极薄外壳+彼此独立的应用）。
 * 新增应用 = src/apps/ 新目录 + 在此注册；应用之间禁止互相 import 业务代码。
 */
export type AppKey = "script-doctor" | "prompt-studio" | "image-studio" | "video-studio";
export type Phase = "P0" | "P1" | "P2";

export const CURRENT_PHASE: Phase = "P0";

export interface AppDef {
  key: AppKey;
  name: string;
  icon: string; // lucide-react 图标名，UI 层映射
  description: string;
  phase: Phase;
  /** 角色→应用可见性（§4）；UI + API 双重校验 */
  rolesVisible: ProjectRole[];
  route: (projectId: string) => string;
  billingActions: ("llm" | "image" | "video")[];
}

export const APPS: AppDef[] = [
  {
    key: "script-doctor",
    name: "剧本医生",
    icon: "Stethoscope",
    description: "分镜前置：诊断视听语言/合规/连贯性，影视化改写出 AI 友好版本",
    phase: "P0",
    rolesVisible: ["director"],
    route: (id) => `/projects/${id}/apps/script-doctor`,
    billingActions: ["llm"],
  },
  {
    key: "prompt-studio",
    name: "提示词生成器",
    icon: "Wand2",
    description: "资产（人物/服装/道具/场景/群演）/ 静帧 / 视频三工作区提示词",
    phase: "P0",
    rolesVisible: ["director", "artist", "storyboard"],
    route: (id) => `/projects/${id}/apps/prompt-studio`,
    billingActions: ["llm"],
  },
  {
    key: "image-studio",
    name: "图像生成器",
    icon: "Image",
    description: "image2 生成 / 编辑溶图，产出入项目资产墙",
    phase: "P1",
    rolesVisible: ["director", "artist", "storyboard"],
    route: (id) => `/projects/${id}/apps/image-studio`,
    billingActions: ["image"],
  },
  {
    key: "video-studio",
    name: "视频生成器",
    icon: "Clapperboard",
    description: "Seedance 2.0 多图参考视频生成",
    phase: "P2",
    rolesVisible: ["director", "storyboard"],
    route: (id) => `/projects/${id}/apps/video-studio`,
    billingActions: ["video"],
  },
];

const PHASE_ORDER: Record<Phase, number> = { P0: 0, P1: 1, P2: 2 };

export function isAppLive(app: AppDef) {
  return PHASE_ORDER[app.phase] <= PHASE_ORDER[CURRENT_PHASE];
}

export function getApp(key: string) {
  return APPS.find((a) => a.key === key);
}

/** 角色可见应用（后期=只读产物与③④成果，不进生成应用） */
export function appsVisibleFor(role: ProjectRole) {
  return APPS.filter((a) => a.rolesVisible.includes(role));
}

/** 提示词生成器内的工作区可见性：美术=资产区；分镜=静帧/视频区；导演=全部 */
export type PromptMode = "人物" | "服装" | "道具" | "场景" | "群演" | "静帧" | "视频";
export const ASSET_MODES: PromptMode[] = ["人物", "服装", "道具", "场景", "群演"];

export function promptModesFor(role: ProjectRole): PromptMode[] {
  if (role === "director") return [...ASSET_MODES, "静帧", "视频"];
  if (role === "artist") return [...ASSET_MODES];
  if (role === "storyboard") return ["静帧", "视频"];
  return [];
}

/** 四阶段流水线：资产 → 分镜表 → 静帧 → 视频（分镜表/静帧/视频同属分镜师工作面） */
export type PromptStage = "资产" | "分镜表" | "静帧" | "视频";

export function promptStagesFor(role: ProjectRole): PromptStage[] {
  if (role === "director") return ["资产", "分镜表", "静帧", "视频"];
  if (role === "artist") return ["资产"];
  if (role === "storyboard") return ["分镜表", "静帧", "视频"];
  return [];
}
