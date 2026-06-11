import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { currentUser } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { creditLedger } from "@/lib/db/schema";
import { getBalance } from "@/lib/billing/charge";
import { LEDGER_REASON_LABELS } from "@/lib/labels";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata = { title: "钱包" };

function refSummary(ref: unknown): string {
  if (!ref || typeof ref !== "object") return "";
  const r = ref as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof r.appKey === "string") parts.push(String(r.appKey));
  if (typeof r.model === "string") parts.push(String(r.model));
  const usage = r.usage as Record<string, number> | undefined;
  if (usage) {
    parts.push(
      `in ${usage.inputTokens ?? 0}${usage.cacheReadTokens ? `(+缓存${usage.cacheReadTokens})` : ""} / out ${usage.outputTokens ?? 0}`
    );
  }
  if (typeof r.note === "string") parts.push(String(r.note));
  return parts.join(" · ");
}

export default async function WalletPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  const balance = await getBalance(user.id);
  const ledger = await db
    .select()
    .from(creditLedger)
    .where(eq(creditLedger.userId, user.id))
    .orderBy(desc(creditLedger.createdAt))
    .limit(200);

  return (
    <div className="space-y-6">
      <h1 className="text-lg">钱包</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">积分余额</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl text-primary">{balance.toLocaleString()}</div>
            <p className="mt-1 text-xs text-muted-foreground">1 元 = 100 积分</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">充值</CardTitle>
          </CardHeader>
          <CardContent className="text-sm leading-6 text-muted-foreground">
            当前支持对公转账后由管理员充值入账。
            <br />
            在线充值（微信 / 支付宝）将在后续版本开放。
          </CardContent>
        </Card>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm text-muted-foreground">积分流水（最近 200 条）</h2>
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>时间</TableHead>
                <TableHead>类型</TableHead>
                <TableHead className="text-right">变动</TableHead>
                <TableHead className="text-right">余额</TableHead>
                <TableHead>明细</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ledger.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                    暂无流水
                  </TableCell>
                </TableRow>
              ) : (
                ledger.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {l.createdAt.toLocaleString("zh-CN")}
                    </TableCell>
                    <TableCell>{LEDGER_REASON_LABELS[l.reason] ?? l.reason}</TableCell>
                    <TableCell
                      className={`text-right ${l.deltaCredits >= 0 ? "text-primary" : ""}`}
                    >
                      {l.deltaCredits >= 0 ? "+" : ""}
                      {l.deltaCredits.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {l.balanceAfter.toLocaleString()}
                    </TableCell>
                    <TableCell className="max-w-72 truncate text-xs text-muted-foreground">
                      {refSummary(l.ref)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
