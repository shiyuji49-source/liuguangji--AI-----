import { eq } from "drizzle-orm";
import { db } from "../db";
import { scripts } from "../db/schema";
import { requireProjectMember, AuthError } from "../auth-helpers";

/**
 * 取剧本并校验访问权。剧本是项目数据：
 * - 读（列表/详情/单集/注入对话）：任意项目成员（分镜师做静帧需读本集剧本）。
 * - 写（上传/删除）：仅项目导演（剧本由导演把关）。
 */
export async function loadScript(scriptId: string, opts?: { requireDirector?: boolean }) {
  const script = await db.query.scripts.findFirst({ where: eq(scripts.id, scriptId) });
  if (!script) throw new AuthError("剧本不存在", 404);
  await requireProjectMember(script.projectId, opts?.requireDirector ? ["director"] : undefined);
  return script;
}
