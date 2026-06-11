"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ProjectSpecFields, type ProjectSpec } from "@/components/project-spec-fields";
import { TIER_LABELS, PRODUCTION_TYPE_HINT } from "@/lib/labels";

export function ProjectSpecCard({
  projectId,
  spec,
  canEdit,
}: {
  projectId: string;
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
    { label: "风格/题材", value: spec.styleGenre || "—（从剧本推导）" },
  ];

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-3 py-4">
        {items.map((it) => (
          <div key={it.label}>
            <div className="text-xs text-muted-foreground">{it.label}</div>
            <div className="text-sm">{it.value}</div>
          </div>
        ))}
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-muted-foreground">{PRODUCTION_TYPE_HINT[spec.productionType]}</span>
          {canEdit && (
            <Button
              variant="outline"
              size="sm"
              className="h-7"
              onClick={() => {
                setDraft(spec);
                setOpen(true);
              }}
            >
              <Pencil className="size-3.5" /> 编辑规格
            </Button>
          )}
        </div>
      </CardContent>

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
                改动对之后的生成生效；已生成的产物不变。画幅/级别即时贯穿，制作类型/风格为软提示。
              </p>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </Card>
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
