import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { consumeToken } from "@/lib/tokens";

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  const base = process.env.AUTH_URL ?? "http://localhost:3000";
  if (!token) return Response.redirect(`${base}/login?verify=invalid`);

  const email = await consumeToken(token, "email_verify");
  if (!email) return Response.redirect(`${base}/login?verify=invalid`);

  await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.email, email));
  return Response.redirect(`${base}/login?verify=ok`);
}
