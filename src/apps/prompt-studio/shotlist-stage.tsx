"use client";

import { useState } from "react";
import { Clapperboard, Loader2, Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Shot } from "./types";

/**
 * 阶段②分镜表（shotlist）：静帧/视频提示词的前置。
 * 「构建分镜表」内嵌分镜大师的关键帧筛选与合并规则；表格可编辑/增删，needStill 按分级取舍。
 */
export function ShotlistStage({
  projectId,
  scriptId,
  episodeNo,
  shots,
  onShotsChange,
}: {
  projectId: string;
  scriptId: string | null;
  episodeNo: number | null;
  shots: Shot[];
  onShotsChange: (shots: Shot[]) => void;
}) {
  const [building, setBuilding] = useState(false);
  const [editing, setEditing] = useState<Shot | null>(null);

  async function build(replace: boolean) {
    if (!scriptId || !episodeNo) {
      toast.error("先选剧本和集");
      return;
    }
    setBuilding(true);
    try {
      const res = await fetch("/api/prompt-studio/shotlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, scriptId, episodeNo, replace }),
      });
      const data = await res.json();
      if (res.status === 409 && data.needConfirm) {
        if (confirm(data.error)) await build(true);
        return;
      }
      if (!res.ok) {
        toast.error(data.error ?? "构建失败");
        return;
      }
      onShotsChange(data.shots);
      toast.success(`分镜表已构建：${data.shots.length} 镜（消耗 ${data.credits} 积分）`);
    } finally {
      setBuilding(false);
    }
  }

  async function patchShot(id: string, patch: Partial<Shot>) {
    onShotsChange(shots.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    const res = await fetch(`/api/prompt-studio/shots/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) toast.error("保存失败");
  }

  async function deleteShot(id: string) {
    await fetch(`/api/prompt-studio/shots/${id}`, { method: "DELETE" });
    onShotsChange(shots.filter((s) => s.id !== id));
  }

  async function addShot() {
    if (!scriptId || !episodeNo) return;
    const res = await fetch("/api/prompt-studio/shots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, scriptId, episodeNo }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "添加失败");
      return;
    }
    onShotsChange([...shots, data.shot]);
    setEditing(data.shot);
  }

  if (!episodeNo) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          先在上方选一集，再构建分镜表
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
        <Button size="sm" className="h-8" onClick={() => build(false)} disabled={building}>
          {building ? <Loader2 className="size-3.5 animate-spin" /> : <Clapperboard className="size-3.5" />}
          {shots.length > 0 ? "重新构建分镜表" : "构建分镜表"}
        </Button>
        {shots.length > 0 && (
          <Button variant="outline" size="sm" className="h-8" onClick={addShot}>
            <Plus className="size-3.5" /> 加一镜
          </Button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {shots.length > 0
            ? `${shots.length} 镜 · ${shots.filter((s) => s.needStill).length} 镜需出静帧`
            : "按分镜大师的关键帧筛选规则自动拆镜"}
        </span>
      </div>

      {shots.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            还没有分镜表。点「构建分镜表」把本集拆成镜头列表（景别/运镜/台词/关联资产），
            静帧和视频提示词都从这张表上生成。
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">镜号</TableHead>
                <TableHead className="w-32">场</TableHead>
                <TableHead>画面</TableHead>
                <TableHead className="w-16">景别</TableHead>
                <TableHead className="w-24">运镜</TableHead>
                <TableHead className="w-14">时长</TableHead>
                <TableHead className="w-40">关联资产</TableHead>
                <TableHead className="w-16">出静帧</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {shots.map((s) => (
                <TableRow key={s.id} className={s.needStill ? "" : "opacity-55"}>
                  <TableCell>{s.shotNo}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{s.sceneLabel}</TableCell>
                  <TableCell className="max-w-72">
                    <div className="truncate text-sm">{s.summary}</div>
                    {s.dialogue && (
                      <div className="truncate text-xs text-muted-foreground">「{s.dialogue}」</div>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">{s.shotType}</TableCell>
                  <TableCell className="text-xs">{s.cameraMove}</TableCell>
                  <TableCell className="text-xs">{s.durationSec ? `${s.durationSec}s` : "—"}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {((s.assetRefs as string[] | null) ?? []).slice(0, 4).map((a) => (
                        <Badge key={a} variant="outline" className="px-1 py-0 text-[10px]">
                          {a}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={s.needStill}
                      onCheckedChange={(v) => patchShot(s.id, { needStill: v })}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-0.5">
                      <Button variant="ghost" size="sm" className="h-7 px-1.5" onClick={() => setEditing(s)}>
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-1.5 text-muted-foreground hover:text-destructive"
                        onClick={() => deleteShot(s.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <ShotEditDialog
        shot={editing}
        onClose={() => setEditing(null)}
        onSave={async (patch) => {
          if (editing) await patchShot(editing.id, patch);
          setEditing(null);
        }}
      />
    </div>
  );
}

function ShotEditDialog({
  shot,
  onClose,
  onSave,
}: {
  shot: Shot | null;
  onClose: () => void;
  onSave: (patch: Partial<Shot>) => void;
}) {
  return (
    <Dialog open={!!shot} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>编辑镜 {shot?.shotNo}</DialogTitle>
        </DialogHeader>
        {shot && <ShotEditForm key={shot.id} shot={shot} onSave={onSave} />}
      </DialogContent>
    </Dialog>
  );
}

function ShotEditForm({ shot, onSave }: { shot: Shot; onSave: (patch: Partial<Shot>) => void }) {
  const [sceneLabel, setSceneLabel] = useState(shot.sceneLabel);
  const [summary, setSummary] = useState(shot.summary);
  const [shotType, setShotType] = useState(shot.shotType);
  const [cameraMove, setCameraMove] = useState(shot.cameraMove);
  const [dialogue, setDialogue] = useState(shot.dialogue);
  const [durationSec, setDurationSec] = useState(shot.durationSec ? String(shot.durationSec) : "");
  const [assetRefs, setAssetRefs] = useState(((shot.assetRefs as string[] | null) ?? []).join("、"));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>场</Label>
          <Input value={sceneLabel} onChange={(e) => setSceneLabel(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>景别</Label>
          <Input value={shotType} onChange={(e) => setShotType(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>运镜</Label>
          <Input value={cameraMove} onChange={(e) => setCameraMove(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>时长（秒）</Label>
          <Input
            value={durationSec}
            onChange={(e) => setDurationSec(e.target.value.replace(/[^0-9]/g, ""))}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>画面 / 动作摘要</Label>
        <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} />
      </div>
      <div className="space-y-1.5">
        <Label>台词 / 声音</Label>
        <Input value={dialogue} onChange={(e) => setDialogue(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label>关联资产（顿号分隔，如 @木兰、@横刀）</Label>
        <Input value={assetRefs} onChange={(e) => setAssetRefs(e.target.value)} />
      </div>
      <Button
        className="w-full"
        onClick={() =>
          onSave({
            sceneLabel,
            summary,
            shotType,
            cameraMove,
            dialogue,
            durationSec: durationSec ? Number(durationSec) : null,
            assetRefs: assetRefs
              .split(/[、,，\s]+/)
              .map((s) => s.trim())
              .filter(Boolean),
          })
        }
      >
        保存
      </Button>
    </div>
  );
}
