import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * 存储抽象层（生成器产物落地：图片/视频）。
 * driver=local：写本地磁盘（dev=仓库内 .storage；生产 docker=挂载卷 /data/assets）。
 * 预留 oss/s3 驱动位；assets.filePath 存"逻辑 key"（projectId/xxx.png），
 * 由 GET /api/assets/[...path] 鉴权后吐字节——产物不落 public、不公开直链。
 */
const DRIVER = process.env.STORAGE_DRIVER ?? "local";
const LOCAL_DIR = process.env.STORAGE_LOCAL_DIR || path.join(process.cwd(), ".storage");

// contentType ↔ 扩展名
const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};
const EXT_TO_CT: Record<string, string> = Object.fromEntries(
  Object.entries(EXT).map(([ct, e]) => [e, ct])
);

export type PutResult = { key: string; bytes: number; contentType: string };

/** 防目录穿越：归一化、拒绝绝对路径与 .. */
function safeKey(key: string): string {
  const norm = path.posix.normalize(key);
  if (norm.startsWith("/") || norm.split("/").includes("..")) {
    throw Object.assign(new Error("非法存储路径"), { status: 400 });
  }
  return norm;
}

/** 存二进制 → 返回逻辑 key（写进 assets.filePath）。key = projectId/prefix-uuid.ext */
export async function put(opts: {
  buffer: Buffer;
  contentType: string;
  projectId: string;
  prefix?: string;
}): Promise<PutResult> {
  const ext = EXT[opts.contentType] ?? "bin";
  const key = `${opts.projectId}/${opts.prefix ?? "asset"}-${randomUUID()}.${ext}`;
  if (DRIVER === "local") {
    const full = path.join(LOCAL_DIR, key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, opts.buffer);
  } else {
    throw new Error(`未实现的存储驱动: ${DRIVER}`);
  }
  return { key, bytes: opts.buffer.length, contentType: opts.contentType };
}

/** 把 base64 或 dataURL 解码后存储（DMXAPI 出图返回 base64） */
export async function putBase64(opts: {
  data: string;
  contentType?: string;
  projectId: string;
  prefix?: string;
}): Promise<PutResult> {
  let b64 = opts.data.trim();
  let ct = opts.contentType ?? "image/png";
  const m = b64.match(/^data:([^;]+);base64,([\s\S]*)$/);
  if (m) {
    ct = m[1];
    b64 = m[2];
  }
  return put({
    buffer: Buffer.from(b64, "base64"),
    contentType: ct,
    projectId: opts.projectId,
    prefix: opts.prefix,
  });
}

/** 从远端 URL 拉取并存储（Seedance 出片返回签名 URL，~24h 过期，必须立刻转存） */
export async function putFromUrl(opts: {
  url: string;
  projectId: string;
  prefix?: string;
}): Promise<PutResult> {
  const res = await fetch(opts.url);
  if (!res.ok) throw new Error(`拉取远端文件失败 ${res.status}`);
  const ct = res.headers.get("content-type")?.split(";")[0] ?? "video/mp4";
  const buffer = Buffer.from(await res.arrayBuffer());
  return put({ buffer, contentType: ct, projectId: opts.projectId, prefix: opts.prefix });
}

/** 读回二进制（serve route 用）。找不到返回 null */
export async function getBuffer(key: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  const k = safeKey(key);
  if (DRIVER === "local") {
    try {
      const buffer = await readFile(path.join(LOCAL_DIR, k));
      const ext = path.extname(k).slice(1).toLowerCase();
      return { buffer, contentType: EXT_TO_CT[ext] ?? "application/octet-stream" };
    } catch {
      return null;
    }
  }
  return null;
}
