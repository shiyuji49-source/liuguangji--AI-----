"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ProjectSpecFields, DEFAULT_SPEC, type ProjectSpec } from "@/components/project-spec-fields";

export function CreateProjectDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [spec, setSpec] = useState<ProjectSpec>(DEFAULT_SPEC);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, ...spec, styleGenre: spec.styleGenre || undefined }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      toast.error(data.error ?? "创建失败");
      return;
    }
    setOpen(false);
    router.push(`/projects/${data.id}`);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>新建项目</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>新建项目</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="name">项目名称</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">
              创作规格（贯穿全部应用，建好后可在项目里修改）
            </p>
            <ProjectSpecFields value={spec} onChange={setSpec} />
          </div>
          <Button type="submit" className="w-full" disabled={loading || !name.trim()}>
            {loading ? "创建中…" : "创建项目"}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            建好后即可上传剧本；剧本医生可选，也能直接拿剧本进提示词生成器
          </p>
        </form>
      </DialogContent>
    </Dialog>
  );
}
