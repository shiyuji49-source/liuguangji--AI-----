"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clapperboard, Wallet, Settings2, LogOut } from "lucide-react";
import { signOut } from "next-auth/react";

const ICONS = { Clapperboard, Wallet, Settings2 } as const;

export type RailItem = { href: string; icon: keyof typeof ICONS; label: string };

/** 左侧图标导航栏（参考游戏面板式布局：纯图标+激活金光） */
export function RailNav({ items }: { items: RailItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col items-center gap-1.5">
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        const active =
          item.href === "/projects"
            ? pathname === "/" || pathname.startsWith("/projects")
            : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className="rail-item"
            data-active={active}
            title={item.label}
          >
            <Icon className="size-5" />
          </Link>
        );
      })}
    </nav>
  );
}

export function RailSignOut() {
  return (
    <button
      className="rail-item"
      title="退出登录"
      onClick={() => signOut({ callbackUrl: "/login" })}
    >
      <LogOut className="size-5" />
    </button>
  );
}
