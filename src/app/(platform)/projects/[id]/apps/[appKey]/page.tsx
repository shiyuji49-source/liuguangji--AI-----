import { redirect, notFound } from "next/navigation";
import { requireProjectMember, AuthError } from "@/lib/auth-helpers";
import { getApp, isAppLive, appsVisibleFor } from "@/apps/registry";
import { PromptStudioApp } from "@/apps/prompt-studio";
import { ScriptDoctorApp } from "@/apps/script-doctor";
import { LiuguangFlowApp } from "@/apps/liuguang-flow";

export default async function AppHostPage({
  params,
}: {
  params: Promise<{ id: string; appKey: string }>;
}) {
  const { id, appKey } = await params;
  // 旧入口（图像/视频生成器）已合并为鎏光flow，重定向兼容旧链接/书签
  if (appKey === "image-studio" || appKey === "video-studio") {
    redirect(`/projects/${id}/apps/liuguang-flow`);
  }
  const app = getApp(appKey);
  if (!app) notFound();

  let ctx;
  try {
    ctx = await requireProjectMember(id);
  } catch (e) {
    if (e instanceof AuthError && e.status === 401) redirect("/login");
    if (e instanceof AuthError && e.status === 404) notFound();
    redirect("/projects");
  }
  const { user, project, projectRole } = ctx;

  // UI 层可见性校验（API 层在各应用路由内再校验一次）
  if (!isAppLive(app) || !appsVisibleFor(projectRole).some((a) => a.key === app.key)) {
    redirect(`/projects/${id}`);
  }

  const common = {
    projectId: project.id,
    projectName: project.name,
    projectTier: project.tier,
    projectAspect: project.aspect,
    projectProductionType: project.productionType,
    projectStyleGenre: project.styleGenre ?? "",
    projectRole,
    userId: user.id,
  };

  switch (app.key) {
    case "script-doctor":
      return <ScriptDoctorApp {...common} />;
    case "prompt-studio":
      return <PromptStudioApp {...common} />;
    case "liuguang-flow":
      return <LiuguangFlowApp {...common} />;
    default:
      notFound();
  }
}
