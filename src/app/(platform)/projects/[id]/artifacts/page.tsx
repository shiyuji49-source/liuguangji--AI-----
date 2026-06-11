import { redirect, notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { artifacts, users } from "@/lib/db/schema";
import { requireProjectMember, AuthError } from "@/lib/auth-helpers";
import { ArtifactList } from "@/components/artifact-list";

export const metadata = { title: "项目产物" };

export default async function ArtifactsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await requireProjectMember(id);
  } catch (e) {
    if (e instanceof AuthError && e.status === 401) redirect("/login");
    if (e instanceof AuthError && e.status === 404) notFound();
    redirect("/projects");
  }

  const rows = await db
    .select({
      id: artifacts.id,
      type: artifacts.type,
      title: artifacts.title,
      content: artifacts.content,
      version: artifacts.version,
      createdAt: artifacts.createdAt,
      authorName: users.name,
    })
    .from(artifacts)
    .innerJoin(users, eq(artifacts.createdBy, users.id))
    .where(eq(artifacts.projectId, id))
    .orderBy(desc(artifacts.createdAt));

  return (
    <div className="space-y-6">
      <h1 className="text-lg">项目产物</h1>
      <ArtifactList
        items={rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))}
      />
    </div>
  );
}
