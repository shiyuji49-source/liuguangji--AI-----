import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth-helpers";
import { PLATFORM_ROLE_LABELS } from "@/lib/labels";
import { ChangePasswordForm } from "./change-password-form";

export const metadata = { title: "账号设置" };

export default async function AccountPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="text-lg">账号设置</h1>

      <section className="space-y-2 rounded-2xl border border-border bg-card p-5">
        <div className="text-sm text-muted-foreground">姓名</div>
        <div className="text-sm">{user.name}</div>
        <div className="mt-3 text-sm text-muted-foreground">邮箱</div>
        <div className="text-sm">{user.email}</div>
        <div className="mt-3 text-sm text-muted-foreground">角色</div>
        <div className="text-sm">{PLATFORM_ROLE_LABELS[user.role]}</div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="mb-3 text-sm font-medium">修改登录密码</h2>
        <ChangePasswordForm />
      </section>
    </div>
  );
}
