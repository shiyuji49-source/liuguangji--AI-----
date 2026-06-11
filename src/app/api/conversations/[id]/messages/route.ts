import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversations, messages } from "@/lib/db/schema";
import { requireUser, AuthError, toErrorResponse } from "@/lib/auth-helpers";

type Params = { params: Promise<{ id: string }> };

type Attachment =
  | { kind: "doc"; name: string; text: string }
  | { kind: "image"; mediaType: string; dataUrl: string };

/** 返回 UIMessage 形状（含计费 meta），供前端直接 setMessages */
export async function GET(_req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const user = await requireUser();
    const conv = await db.query.conversations.findFirst({ where: eq(conversations.id, id) });
    if (!conv) throw new AuthError("会话不存在", 404);
    if (conv.createdBy !== user.id) throw new AuthError("无权访问该会话", 403);

    const rows = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(asc(messages.createdAt));

    const uiMessages = rows.map((r) => {
      const atts = (r.attachments as Attachment[] | null) ?? [];
      const parts: Array<
        | { type: "text"; text: string }
        | { type: "file"; mediaType: string; url: string }
      > = [];
      for (const a of atts) {
        if (a.kind === "image") parts.push({ type: "file", mediaType: a.mediaType, url: a.dataUrl });
      }
      parts.push({ type: "text", text: r.content });
      return {
        id: r.id,
        role: r.role,
        parts,
        metadata: {
          ...(r.meta as Record<string, unknown> | null),
          docs: atts.filter((a) => a.kind === "doc").map((a) => ({ name: a.name, chars: a.text.length })),
          createdAt: r.createdAt.toISOString(),
        },
      };
    });
    return Response.json({ messages: uiMessages });
  } catch (e) {
    return toErrorResponse(e);
  }
}
