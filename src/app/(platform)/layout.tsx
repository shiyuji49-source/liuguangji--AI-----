import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth-helpers";
import { getBalance } from "@/lib/billing/charge";
import { PLATFORM_ROLE_LABELS } from "@/lib/labels";
import { SignOutButton } from "@/components/sign-out-button";

// 平台内页面全部依赖会话与 DB，禁止构建期预渲染
export const dynamic = "force-dynamic";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const balance = await getBalance(user.id);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-6 px-4">
          <Link href="/projects" className="text-base tracking-[0.25em] text-primary">
            鎏光机
          </Link>
          <nav className="flex items-center gap-4 text-sm text-muted-foreground">
            <Link href="/projects" className="hover:text-foreground">
              项目
            </Link>
            <Link href="/wallet" className="hover:text-foreground">
              钱包
              <span className="ml-1.5 text-primary">{balance.toLocaleString()}</span>
            </Link>
            {user.role === "admin" && (
              <Link href="/admin" className="hover:text-foreground">
                管理
              </Link>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">
              {user.name}
              <span className="ml-1.5 rounded border border-border px-1.5 py-0.5 text-xs">
                {PLATFORM_ROLE_LABELS[user.role]}
              </span>
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
