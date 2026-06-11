import { eq } from "drizzle-orm";
import { db } from "../db";
import { shots, videoSegments } from "../db/schema";
import { AuthError, requireProjectMember } from "../auth-helpers";
import { promptModesFor, ASSET_MODES, type PromptMode } from "@/apps/registry";
import type { ProjectRole } from "../db/schema";
import type { Workspace } from "./run";

/** 工作区访问校验（与 registry 的角色→工作区可见性一致） */
export function assertWorkspaceAccess(role: ProjectRole, workspace: Workspace) {
  const allowed = promptModesFor(role);
  const ok =
    workspace === "资产"
      ? allowed.some((m) => (ASSET_MODES as string[]).includes(m))
      : allowed.includes(workspace as PromptMode);
  if (!ok) throw new AuthError("当前角色无权使用该工作区", 403);
}

/** 资产 kind 校验（人物/服装/… 须在角色可用模式内） */
export function assertKindAccess(role: ProjectRole, kind: string) {
  const allowed = promptModesFor(role) as string[];
  if (!allowed.includes(kind)) throw new AuthError("当前角色无权生成该类型", 403);
}

/** 取 shot 并校验项目成员 + 分镜工作区权限 */
export async function loadShotChecked(id: string) {
  const shot = await db.query.shots.findFirst({ where: eq(shots.id, id) });
  if (!shot) throw new AuthError("该镜不存在", 404);
  const ctx = await requireProjectMember(shot.projectId);
  assertWorkspaceAccess(ctx.projectRole, "静帧");
  return { shot, ...ctx };
}

/** 取视频片段并校验项目成员 + 视频工作区权限 */
export async function loadSegmentChecked(id: string) {
  const segment = await db.query.videoSegments.findFirst({ where: eq(videoSegments.id, id) });
  if (!segment) throw new AuthError("该片段不存在", 404);
  const ctx = await requireProjectMember(segment.projectId);
  assertWorkspaceAccess(ctx.projectRole, "视频");
  return { segment, ...ctx };
}
