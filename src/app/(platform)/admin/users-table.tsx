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
import { PLATFORM_ROLE_LABELS } from "@/lib/labels";
import type { PlatformRole } from "@/lib/db/schema";

type Row = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: PlatformRole;
  status: "active" | "banned";
  emailVerified: boolean;
  balance: number;
  createdAt: string;
};

const ROLES = Object.keys(PLATFORM_ROLE_LABELS) as PlatformRole[];

export function UsersTable({ users }: { users: Row[] }) {
  const router = useRouter();
  const [recharging, setRecharging] = useState<Row | null>(null);

  async function patch(id: string, body: Record<string, string>) {
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "操作失败");
      return;
    }
    router.refresh();
  }

  return (
    <>
      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>用户</TableHead>
              <TableHead>账号</TableHead>
              <TableHead>平台角色</TableHead>
              <TableHead className="text-right">积分余额</TableHead>
              <TableHead>注册时间</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="w-44">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id} className={u.status === "banned" ? "opacity-50" : ""}>
                <TableCell>{u.name}</TableCell>
                <TableCell className="text-muted-foreground">
                  {u.email ?? u.phone}
                  {u.email && !u.emailVerified && (
                    <span className="ml-1 text-xs text-destructive">未验证</span>
                  )}
                </TableCell>
                <TableCell>
                  <Select value={u.role} onValueChange={(v) => patch(u.id, { role: v })}>
                    <SelectTrigger className="h-7 w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map((r) => (
                        <SelectItem key={r} value={r}>
                          {PLATFORM_ROLE_LABELS[r]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="text-right text-primary">
                  {u.balance.toLocaleString()}
                </TableCell>
                <TableCell className="text-muted-foreground">{u.createdAt}</TableCell>
                <TableCell>{u.status === "active" ? "正常" : "已停用"}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="outline" size="sm" className="h-7" onClick={() => setRecharging(u)}>
                      充值
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={`h-7 ${u.status === "active" ? "text-destructive" : "text-primary"}`}
                      onClick={() =>
                        patch(u.id, { status: u.status === "active" ? "banned" : "active" })
                      }
                    >
                      {u.status === "active" ? "封号" : "解封"}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <RechargeDialog user={recharging} onClose={() => setRecharging(null)} />
    </>
  );
}

function RechargeDialog({ user, onClose }: { user: Row | null; onClose: () => void }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const credits = Math.round(Number(amount || 0) * 100);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setLoading(true);
    const res = await fetch("/api/admin/recharge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id, amountYuan: Number(amount) }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      toast.error(data.error ?? "充值失败");
      return;
    }
    toast.success(`已为 ${user.name} 充值 ${credits.toLocaleString()} 积分`);
    setAmount("");
    onClose();
    router.refresh();
  }

  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>手动充值 · {user?.name}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="amount">充值金额（元）</Label>
            <Input
              id="amount"
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">
              到账 <span className="text-primary">{credits.toLocaleString()}</span> 积分（1 元 = 100 积分）
            </p>
          </div>
          <Button type="submit" className="w-full" disabled={loading || credits <= 0}>
            {loading ? "入账中…" : "确认充值"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
