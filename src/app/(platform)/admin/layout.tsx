import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth-helpers";

export const metadata = { title: "管理" };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/projects");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <h1 className="text-lg">平台管理</h1>
        <nav className="flex gap-3 text-sm text-muted-foreground">
          <Link href="/admin" className="hover:text-foreground">
            用户
          </Link>
          <Link href="/admin/pricing" className="hover:text-foreground">
            计费定价
          </Link>
        </nav>
      </div>
      {children}
    </div>
  );
}
