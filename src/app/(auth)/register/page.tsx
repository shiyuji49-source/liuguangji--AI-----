import Link from "next/link";
import { smsEnabled } from "@/lib/sms";
import { RegisterForm } from "./register-form";

export default function RegisterPage() {
  // 内测开关：关闭公开注册时显示提示页（API 同步拦截）
  if (process.env.ALLOW_REGISTRATION === "false") {
    return (
      <div className="space-y-4 rounded-2xl border border-border bg-card p-8 text-center">
        <h1 className="text-lg font-medium">内测期间未开放注册</h1>
        <p className="text-sm text-muted-foreground">请联系管理员为你开通账号并分配初始积分。</p>
        <Link href="/login" className="text-sm text-primary underline-offset-4 hover:underline">
          返回登录
        </Link>
      </div>
    );
  }
  return <RegisterForm smsEnabled={smsEnabled()} />;
}
