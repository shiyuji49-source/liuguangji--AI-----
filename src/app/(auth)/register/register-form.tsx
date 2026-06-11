"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export function RegisterForm({ smsEnabled }: { smsEnabled: boolean }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);

  async function submit(kind: "email" | "phone") {
    setLoading(true);
    setError(null);
    const payload =
      kind === "email"
        ? { kind, name, email, password, agree }
        : { kind, name, phone, code, password, agree };
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? "注册失败");
      return;
    }
    setDone(data.message);
  }

  async function sendCode() {
    setError(null);
    const res = await fetch("/api/auth/sms-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "发送失败");
      return;
    }
    setCountdown(60);
    const timer = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) clearInterval(timer);
        return c - 1;
      });
    }, 1000);
  }

  if (done) {
    return (
      <Card>
        <CardContent className="space-y-4 pt-6 text-center">
          <p className="text-sm">{done}</p>
          <Button asChild className="w-full">
            <Link href="/login">去登录</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const commonFields = (
    <>
      <div className="space-y-2">
        <Label htmlFor="name">姓名</Label>
        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
    </>
  );

  const passwordField = (
    <div className="space-y-2">
      <Label htmlFor="password">密码（至少 8 位）</Label>
      <Input
        id="password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="new-password"
        required
      />
    </div>
  );

  const agreement = (
    <label className="flex items-start gap-2 text-xs text-muted-foreground">
      <input
        type="checkbox"
        checked={agree}
        onChange={(e) => setAgree(e.target.checked)}
        className="mt-0.5 accent-[var(--primary)]"
      />
      <span>
        我已阅读并同意{" "}
        <Link href="/terms" target="_blank" className="text-primary">
          《用户协议》
        </Link>{" "}
        与{" "}
        <Link href="/privacy" target="_blank" className="text-primary">
          《隐私政策》
        </Link>
      </span>
    </label>
  );

  const emailForm = (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit("email");
      }}
    >
      {commonFields}
      <div className="space-y-2">
        <Label htmlFor="email">邮箱</Label>
        <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      {passwordField}
      {agreement}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "注册中…" : "注册"}
      </Button>
    </form>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>注册</CardTitle>
      </CardHeader>
      <CardContent>
        {smsEnabled ? (
          <Tabs defaultValue="email">
            <TabsList className="mb-4 w-full">
              <TabsTrigger value="email" className="flex-1">
                邮箱注册
              </TabsTrigger>
              <TabsTrigger value="phone" className="flex-1">
                手机号注册
              </TabsTrigger>
            </TabsList>
            <TabsContent value="email">{emailForm}</TabsContent>
            <TabsContent value="phone">
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  submit("phone");
                }}
              >
                {commonFields}
                <div className="space-y-2">
                  <Label htmlFor="phone">手机号</Label>
                  <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sms">验证码</Label>
                  <div className="flex gap-2">
                    <Input id="sms" value={code} onChange={(e) => setCode(e.target.value)} required />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={sendCode}
                      disabled={countdown > 0 || !/^1\d{10}$/.test(phone)}
                    >
                      {countdown > 0 ? `${countdown}s` : "获取验证码"}
                    </Button>
                  </div>
                </div>
                {passwordField}
                {agreement}
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "注册中…" : "注册"}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        ) : (
          emailForm
        )}
        <p className="mt-4 text-center text-sm text-muted-foreground">
          已有账号？{" "}
          <Link href="/login" className="text-primary hover:text-primary-hover">
            登录
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
