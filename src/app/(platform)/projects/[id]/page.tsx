import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { Stethoscope, Wand2, Image as ImageIcon, Clapperboard, FileText } from "lucide-react";
import { db } from "@/lib/db";
import { memberships, users } from "@/lib/db/schema";
import { requireProjectMember, AuthError } from "@/lib/auth-helpers";
import { APPS, appsVisibleFor, isAppLive } from "@/apps/registry";
import { PROJECT_ROLE_LABELS } from "@/lib/labels";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MembersPanel } from "./members-panel";
import { ProjectSpecCard } from "./project-spec-card";
import { ProjectScripts } from "./project-scripts";

const APP_ICONS = {
  Stethoscope,
  Wand2,
  Image: ImageIcon,
  Clapperboard,
} as const;

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let ctx;
  try {
    ctx = await requireProjectMember(id);
  } catch (e) {
    if (e instanceof AuthError && e.status === 401) redirect("/login");
    if (e instanceof AuthError && e.status === 404) notFound();
    redirect("/projects");
  }
  const { user, project, projectRole } = ctx;

  const visibleKeys = new Set(appsVisibleFor(projectRole).map((a) => a.key));
  const isDirector = projectRole === "director";

  const memberRows = await db
    .select({
      userId: memberships.userId,
      role: memberships.projectRole,
      name: users.name,
      email: users.email,
      phone: users.phone,
    })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(eq(memberships.projectId, project.id));

  const spec = {
    tier: project.tier,
    aspect: project.aspect,
    productionType: project.productionType,
    styleGenre: project.styleGenre ?? "",
  };

  return (
    <div className="space-y-8">
      <ProjectSpecCard
        projectId={project.id}
        name={project.name}
        roleLabel={PROJECT_ROLE_LABELS[projectRole]}
        memberCount={memberRows.length}
        spec={spec}
        canEdit={isDirector}
      />

      <ProjectScripts projectId={project.id} canWrite={isDirector} />

      <section className="space-y-3">
        <h2 className="text-sm text-muted-foreground">应用</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {APPS.filter((a) => visibleKeys.has(a.key)).map((app) => {
            const live = isAppLive(app);
            const Icon = APP_ICONS[app.icon as keyof typeof APP_ICONS] ?? FileText;
            const inner = (
              <Card className={live ? "h-full" : "h-full opacity-45"}>
                <CardContent className="flex items-start gap-3.5 pt-6">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-primary/25 bg-[linear-gradient(135deg,rgba(216,177,115,.18),rgba(216,177,115,.05))] shadow-[0_4px_14px_-6px_var(--glow-gold)]">
                    <Icon className="size-5 text-primary" />
                  </span>
                  <span className="min-w-0 space-y-1.5">
                    <span className="flex items-center gap-2">
                      <span className="font-medium">{app.name}</span>
                      {!live && (
                        <Badge variant="outline" className="text-xs">
                          {app.phase} 开放
                        </Badge>
                      )}
                    </span>
                    <p className="text-xs leading-5 text-muted-foreground">{app.description}</p>
                  </span>
                </CardContent>
              </Card>
            );
            return live ? (
              <Link key={app.key} href={app.route(project.id)}>
                {inner}
              </Link>
            ) : (
              <div key={app.key}>{inner}</div>
            );
          })}
          <Link href={`/projects/${project.id}/artifacts`}>
            <Card className="h-full">
              <CardContent className="flex items-start gap-3.5 pt-6">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-border bg-secondary">
                  <FileText className="size-5 text-primary" />
                </span>
                <span className="min-w-0 space-y-1.5">
                  <span className="font-medium">项目产物</span>
                  <p className="text-xs leading-5 text-muted-foreground">
                    剧本 / 资产清单 / 各类提示词产物，全员可查看复制
                  </p>
                </span>
              </CardContent>
            </Card>
          </Link>
        </div>
      </section>

      <MembersPanel
        projectId={project.id}
        members={memberRows.map((m) => ({
          userId: m.userId,
          name: m.name,
          contact: m.email ?? m.phone ?? "",
          role: m.role,
        }))}
        canManage={isDirector}
        selfId={user.id}
      />
    </div>
  );
}
