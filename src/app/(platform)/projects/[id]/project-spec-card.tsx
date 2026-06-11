"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ProjectSpecFields, type ProjectSpec } from "@/components/project-spec-fields";
import { TIER_LABELS } from "@/lib/labels";

/** 项目控制台 Hero：项目名 + 规格徽章 + 规格值 + 鎏字水印装饰 + 编辑（参考游戏面板 hero 卡） */
export function ProjectSpecCard({
  projectId,
  name,
  roleLabel,
  memberCount,
  spec,
  canEdit,
}: {
  projectId: string;
  name: string;
  roleLabel: string;
  memberCount: number;
  spec: ProjectSpec;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ProjectSpec>(spec);
  const [loading, setLoading] = useState(false);

  async function save() {
    setLoading(true);
    const res = await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...draft, styleGenre: draft.styleGenre || null }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      toast.error(data.error ?? "保存失败");
      return;
    }
    toast.success("规格已更新");
    setOpen(false);
    router.refresh();
  }

  const items = [
    { label: "级别", value: TIER_LABELS[spec.tier as "B" | "A" | "S"] ?? spec.tier },
    { label: "画幅", value: spec.aspect },
    { label: "制作类型", value: spec.productionType },
    { label: "风格/题材", value: spec.styleGenre || "从剧本推导" },
  ];

  return (
    <section className="hero-card p-7 sm:p-8">
      <span className="hero-glyph text-liuguang">鎏</span>
      <div className="relative z-10 space-y-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <SpecBadges spec={spec} />
        </div>
        <h1 className="text-3xl font-medium tracking-wide">{name}</h1>
        <p className="text-sm text-muted-foreground">
          我的角色：{roleLabel} · {memberCount} 位成员
        </p>
        <div className="flex flex-wrap items-end gap-x-10 gap-y-3 pt-2">
          {items.map((it) => (
            <div key={it.label}>
              <div className="text-xs text-muted-foreground">{it.label}</div>
              <div className="text-sm">{it.value}</div>
            </div>
          ))}
          {canEdit && (
            <Button
              variant="outline"
              size="sm"
              className="ml-auto h-8 border-primary/30 bg-primary/5"
              onClick={() => {
                setDraft(spec);
                setOpen(true);
              }}
            >
              <Pencil className="size-3.5" /> 编辑规格
            </Button>
          )}
        </div>
      </div>

      {canEdit && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>编辑项目规格</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <ProjectSpecFields value={draft} onChange={setDraft} />
              <Button className="w-full" onClick={save} disabled={loading}>
                {loading ? "保存中…" : "保存"}
              </Button>
              <p className="text-xs text-muted-foreground">
                改动对之后的生成生效；已生成的产物不变。规格随每次生成注入 skill。
              </p>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}

export function SpecBadges({ spec }: { spec: ProjectSpec }) {
  return (
    <>
      <Badge variant="outline" className="border-primary/40 text-primary">
        {TIER_LABELS[spec.tier as "B" | "A" | "S"] ?? spec.tier}
      </Badge>
      <Badge variant="outline">{spec.aspect}</Badge>
      <Badge variant="outline">{spec.productionType}</Badge>
      {spec.styleGenre && <Badge variant="outline">{spec.styleGenre}</Badge>}
    </>
  );
}
