import type { PlatformRole, ProjectRole, ProjectTier } from "./db/schema";

export const PLATFORM_ROLE_LABELS: Record<PlatformRole, string> = {
  member: "普通成员",
  director: "导演",
  storyboard: "分镜师",
  artist: "美术师",
  post: "后期",
  admin: "管理员",
};

export const PROJECT_ROLE_LABELS: Record<ProjectRole, string> = {
  director: "导演",
  storyboard: "分镜师",
  artist: "美术师",
  post: "后期",
};

export const PROJECT_ROLES: ProjectRole[] = ["director", "storyboard", "artist", "post"];

export const TIER_LABELS: Record<ProjectTier, string> = {
  S: "S 级",
  A: "A 级",
  B: "B 级",
};

// 项目级创作规格选项（建项目向导 + 规格卡共用）
export const TIER_OPTIONS: ProjectTier[] = ["B", "A", "S"];

export const ASPECT_OPTIONS = ["9:16", "16:9", "4:5", "3:4", "1:1", "2.39:1"];

export const PRODUCTION_TYPE_OPTIONS = ["真人", "3D", "2D"] as const;
export const PRODUCTION_TYPE_HINT: Record<string, string> = {
  真人: "真人写实（当前 skill 默认）",
  "3D": "3D 渲染（P1 出图时生效）",
  "2D": "2D 动画 / 番剧（P1 出图时生效）",
};

// 风格/题材常用项（可自由填写，非强约束；多数 skill 从剧本自动推导）
export const STYLE_GENRE_SUGGESTIONS = [
  "古装",
  "武侠",
  "仙侠/玄幻",
  "现代都市",
  "年代",
  "悬疑",
  "战争",
  "宫廷",
  "科幻/赛博",
];

export const LEDGER_REASON_LABELS: Record<string, string> = {
  llm: "对话生成",
  image: "图像生成",
  video: "视频生成",
  recharge: "充值",
  admin_adjust: "管理员调整",
  refund: "退款",
};
