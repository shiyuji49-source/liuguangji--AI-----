"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Users } from "lucide-react";
import { PROJECT_ROLE_LABELS } from "@/lib/labels";
import type { ProjectRole } from "@/lib/db/schema";

type Member = { userId: string; name: string; role: ProjectRole };

const UUID_RE = /^\/projects\/([0-9a-f-]{36})/;

/** 右侧成员头像 Rail（参考游戏面板）：进入项目页时显示该项目成员，导演金环标识 */
export function MemberRail() {
  const pathname = usePathname();
  const match = pathname.match(UUID_RE);
  const projectId = match?.[1] ?? null;
  const [members, setMembers] = useState<Member[]>([]);

  useEffect(() => {
    (async () => {
      if (!projectId) {
        setMembers([]);
        return;
      }
      const res = await fetch(`/api/projects/${projectId}/members`);
      if (!res.ok) {
        setMembers([]);
        return;
      }
      const data = await res.json();
      setMembers(data.members);
    })();
  }, [projectId]);

  if (!projectId || members.length === 0) return null;

  return (
    <aside className="hidden w-[68px] shrink-0 flex-col items-center gap-3 border-l border-border py-6 md:flex">
      <Link
        href={`/projects/${projectId}`}
        className="flex size-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:text-foreground"
        title="项目成员"
      >
        <Users className="size-4.5" />
      </Link>
      <div className="flex flex-col items-center gap-2.5">
        {members.map((m) => (
          <div
            key={m.userId}
            title={`${m.name} · ${PROJECT_ROLE_LABELS[m.role]}`}
            className={`flex size-10 items-center justify-center rounded-full text-sm transition-transform hover:scale-110 ${
              m.role === "director"
                ? "border border-primary/60 bg-primary/15 text-primary shadow-[0_0_14px_-2px_var(--glow-gold)]"
                : "border border-border bg-secondary text-foreground/80"
            }`}
          >
            {m.name.slice(0, 1)}
          </div>
        ))}
      </div>
    </aside>
  );
}
