"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ChangePasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (next !== confirm) {
      toast.error("两次输入的新密码不一致");
      return;
    }
    if (next.length < 8) {
      toast.error("新密码至少 8 位");
      return;
    }
    setLoading(true);
    const res = await fetch("/api/account/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: current, newPassword: next }),
    });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      toast.error(data.error ?? "修改失败");
      return;
    }
    toast.success("密码已修改，下次登录用新密码");
    setCurrent("");
    setNext("");
    setConfirm("");
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>当前密码</Label>
        <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
      </div>
      <div className="space-y-1.5">
        <Label>新密码（至少 8 位）</Label>
        <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
      </div>
      <div className="space-y-1.5">
        <Label>确认新密码</Label>
        <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
      </div>
      <Button onClick={submit} disabled={loading || !current || !next || !confirm}>
        {loading ? "提交中…" : "修改密码"}
      </Button>
    </div>
  );
}
