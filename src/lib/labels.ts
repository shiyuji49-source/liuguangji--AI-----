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

export const LEDGER_REASON_LABELS: Record<string, string> = {
  llm: "对话生成",
  image: "图像生成",
  video: "视频生成",
  recharge: "充值",
  admin_adjust: "管理员调整",
  refund: "退款",
};
