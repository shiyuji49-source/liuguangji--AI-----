import { eq } from "drizzle-orm";
import { db } from "../db";
import { scripts } from "../db/schema";
import { requireProjectMember, AuthError } from "../auth-helpers";

/** 取剧本并校验访问权（剧本医生=导演专用，与应用可见性一致） */
export async function loadScriptForDirector(scriptId: string) {
  const script = await db.query.scripts.findFirst({ where: eq(scripts.id, scriptId) });
  if (!script) throw new AuthError("剧本不存在", 404);
  await requireProjectMember(script.projectId, ["director"]);
  return script;
}
