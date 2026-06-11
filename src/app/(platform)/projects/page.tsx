import Link from "next/link";
import { redirect } from "next/navigation";
import { eq, desc } from "drizzle-orm";
import { ArrowRight, Wand2 } from "lucide-react";
import { currentUser } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { memberships, projects } from "@/lib/db/schema";
import { PROJECT_ROLE_LABELS, TIER_LABELS } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CreateProjectDialog } from "./create-project-dialog";

export const metadata = { title: "项目" };

export default async function ProjectsPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  const rows = await db
    .select({ project: projects, role: memberships.projectRole })
    .from(memberships)
    .innerJoin(projects, eq(memberships.projectId, projects.id))
    .where(eq(memberships.userId, user.id))
    .orderBy(desc(projects.createdAt));

  const canCreate = user.role === "director" || user.role === "admin";
  const hero = rows[0];

  return (
    <div className="space-y-8">
      {/* 最近项目 Hero（Valorant 位） */}
      {hero ? (
        <section className="hero-card p-7 sm:p-9">
          <span className="hero-glyph text-liuguang">鎏</span>
          <div className="relative z-10 max-w-[34rem] space-y-4">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="border-primary/50 bg-primary/10 text-primary">
                最近项目
              </Badge>
              <Badge variant="outline">{TIER_LABELS[hero.project.tier]}</Badge>
              <Badge variant="outline">{hero.project.aspect}</Badge>
              <Badge variant="outline">{hero.project.productionType}</Badge>
              {hero.project.styleGenre && <Badge variant="outline">{hero.project.styleGenre}</Badge>}
            </div>
            <h1 className="text-3xl font-medium tracking-wide sm:text-4xl">{hero.project.name}</h1>
            <p className="text-sm text-muted-foreground">
              我的角色：{PROJECT_ROLE_LABELS[hero.role]} ·{" "}
              {hero.project.createdAt.toLocaleDateString("zh-CN")} 创建
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button asChild>
                <Link href={`/projects/${hero.project.id}`}>
                  进入项目 <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" className="border-primary/30 bg-primary/5">
                <Link href={`/projects/${hero.project.id}/apps/prompt-studio`}>
                  <Wand2 className="size-4" /> 提示词生成器
                </Link>
              </Button>
            </div>
          </div>
        </section>
      ) : (
        <section className="hero-card p-9 text-center">
          <span className="hero-glyph text-liuguang">鎏</span>
          <div className="relative z-10 space-y-4">
            <h1 className="text-2xl font-medium">
              {canCreate ? "创建你的第一个项目" : "等待导演邀请你进入项目"}
            </h1>
            <p className="text-sm text-muted-foreground">
              建项目 → 上传剧本 → 提示词生成器四阶段流水线（资产 → 分镜表 → 静帧 → 视频）
            </p>
            {canCreate && (
              <div className="flex justify-center pt-1">
                <CreateProjectDialog />
              </div>
            )}
          </div>
        </section>
      )}

      {/* 项目网格 */}
      {rows.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm text-muted-foreground">我的项目（{rows.length}）</h2>
            {canCreate && <CreateProjectDialog />}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map(({ project, role }) => (
              <Link key={project.id} href={`/projects/${project.id}`}>
                <Card className="h-full">
                  <CardContent className="space-y-3 pt-6">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-base font-medium">{project.name}</span>
                      <Badge variant="outline" className="shrink-0 border-primary/40 text-primary">
                        {TIER_LABELS[project.tier]}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant="outline" className="text-xs">
                        {project.aspect}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        {project.productionType}
                      </Badge>
                      {project.styleGenre && (
                        <Badge variant="outline" className="text-xs">
                          {project.styleGenre}
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {PROJECT_ROLE_LABELS[role]} · {project.createdAt.toLocaleDateString("zh-CN")}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
