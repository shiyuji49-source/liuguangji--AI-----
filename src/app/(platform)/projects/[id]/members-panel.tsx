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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PROJECT_ROLE_LABELS, PROJECT_ROLES } from "@/lib/labels";
import type { ProjectRole } from "@/lib/db/schema";

type Member = { userId: string; name: string; contact: string; role: ProjectRole };

export function MembersPanel({
  projectId,
  members,
  canManage,
  selfId,
}: {
  projectId: string;
  members: Member[];
  canManage: boolean;
  selfId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [role, setRole] = useState<ProjectRole>("storyboard");
  const [loading, setLoading] = useState(false);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch(`/api/projects/${projectId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, role }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      toast.error(data.error ?? "邀请失败");
      return;
    }
    toast.success("已加入项目");
    setOpen(false);
    setIdentifier("");
    router.refresh();
  }

  async function remove(userId: string) {
    const res = await fetch(`/api/projects/${projectId}/members`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "移除失败");
      return;
    }
    router.refresh();
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm text-muted-foreground">成员（{members.length}）</h2>
        {canManage && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                邀请成员
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>邀请已注册用户</DialogTitle>
              </DialogHeader>
              <form onSubmit={invite} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="identifier">对方的注册邮箱或手机号</Label>
                  <Input
                    id="identifier"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>项目内角色</Label>
                  <Select value={role} onValueChange={(v) => setRole(v as ProjectRole)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PROJECT_ROLES.map((r) => (
                        <SelectItem key={r} value={r}>
                          {PROJECT_ROLE_LABELS[r]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "邀请中…" : "邀请"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>
      <div className="rounded-[10px] border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>姓名</TableHead>
              <TableHead>账号</TableHead>
              <TableHead>角色</TableHead>
              {canManage && <TableHead className="w-20" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => (
              <TableRow key={m.userId}>
                <TableCell>{m.name}</TableCell>
                <TableCell className="text-muted-foreground">{m.contact}</TableCell>
                <TableCell>{PROJECT_ROLE_LABELS[m.role]}</TableCell>
                {canManage && (
                  <TableCell>
                    {m.userId !== selfId && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => remove(m.userId)}
                      >
                        移除
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
