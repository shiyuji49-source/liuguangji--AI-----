import Link from "next/link";
import { redirect } from "next/navigation";
import { Sparkles } from "lucide-react";
import { currentUser } from "@/lib/auth-helpers";
import { getBalance } from "@/lib/billing/charge";
import { PLATFORM_ROLE_LABELS } from "@/lib/labels";
import { RailNav, RailSignOut, type RailItem } from "@/components/rail-nav";
import { MemberRail } from "@/components/member-rail";

// 平台内页面全部依赖会话与 DB，禁止构建期预渲染
export const dynamic = "force-dynamic";

function greeting() {
  const hour = Number(
    new Intl.DateTimeFormat("zh-CN", { hour: "numeric", hour12: false, timeZone: "Asia/Shanghai" }).format(
      new Date()
    )
  );
  if (hour < 6) return "夜深了";
  if (hour < 12) return "早上好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const balance = await getBalance(user.id);

  const items: RailItem[] = [
    { href: "/projects", icon: "Clapperboard", label: "项目" },
    { href: "/wallet", icon: "Wallet", label: "钱包" },
    ...(user.role === "admin" ? ([{ href: "/admin", icon: "Settings2", label: "管理" }] as RailItem[]) : []),
  ];

  return (
    <div className="min-h-screen p-3 sm:p-5">
      <div className="app-frame mx-auto flex min-h-[calc(100vh-2.5rem)] w-full max-w-[1480px]">
        {/* 左侧图标 Rail */}
        <aside className="flex w-[76px] shrink-0 flex-col items-center border-r border-white/5 py-6">
          <Link
            href="/projects"
            className="text-liuguang mb-7 text-2xl font-semibold leading-none"
            title="鎏光机"
          >
            鎏
          </Link>
          <RailNav items={items} />
          <div className="mt-auto flex flex-col items-center gap-2">
            <Link
              href="/account"
              className="flex size-10 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-sm text-primary transition-colors hover:border-primary/60 hover:bg-primary/20"
              title={`${user.name} · ${PLATFORM_ROLE_LABELS[user.role]} · 账号设置/改密码`}
            >
              {user.name.slice(0, 1)}
            </Link>
            <RailSignOut />
          </div>
        </aside>

        {/* 主区 */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex flex-wrap items-center gap-3 px-7 pb-1 pt-6">
            <div className="text-lg text-muted-foreground">
              {greeting()}，<span className="font-medium text-foreground">{user.name}</span>
            </div>
            <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
              {PLATFORM_ROLE_LABELS[user.role]}
            </span>
            <Link href="/wallet" className="gold-chip ml-auto" title="钱包">
              <Sparkles className="size-3.5" />
              {balance.toLocaleString()} 积分
            </Link>
          </header>
          <main className="min-w-0 flex-1 px-7 py-5">{children}</main>
        </div>

        {/* 右侧成员头像 Rail（项目页显示） */}
        <MemberRail />
      </div>
    </div>
  );
}
