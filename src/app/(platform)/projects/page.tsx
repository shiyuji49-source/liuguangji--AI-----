import Link from "next/link";
import { redirect } from "next/navigation";
import { eq, desc } from "drizzle-orm";
import { currentUser } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { memberships, projects } from "@/lib/db/schema";
import { PROJECT_ROLE_LABELS, TIER_LABELS } from "@/lib/labels";
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg">我的项目</h1>
        {canCreate && <CreateProjectDialog />}
      </div>
      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {canCreate
              ? "还没有项目，点击右上角「新建项目」开始"
              : "还没有加入任何项目，请等待导演邀请"}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map(({ project, role }) => (
            <Link key={project.id} href={`/projects/${project.id}`}>
              <Card className="transition-colors hover:border-primary/50">
                <CardContent className="space-y-3 pt-6">
                  <div className="flex items-center justify-between">
                    <span className="text-base">{project.name}</span>
                    <Badge variant="outline" className="border-primary/40 text-primary">
                      {TIER_LABELS[project.tier]}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    我的角色：{PROJECT_ROLE_LABELS[role]} ·{" "}
                    {project.createdAt.toLocaleDateString("zh-CN")}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
