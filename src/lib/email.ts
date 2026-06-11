import nodemailer from "nodemailer";

export function emailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function transport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 465),
    secure: process.env.SMTP_SECURE !== "false",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

async function send(to: string, subject: string, html: string) {
  if (!emailConfigured()) {
    // 未配置 SMTP 时（本地开发）打印到日志，便于手测链路
    console.warn(`[email 未配置 SMTP] to=${to} subject=${subject}\n${html}`);
    return;
  }
  await transport().sendMail({
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
    to,
    subject,
    html,
  });
}

function baseUrl() {
  return process.env.AUTH_URL ?? "http://localhost:3000";
}

const wrap = (inner: string) => `
<div style="background:#0E0F12;color:#E8E6E1;padding:32px;font-family:system-ui,sans-serif">
  <div style="max-width:480px;margin:0 auto;background:#16181D;border:1px solid #262A33;border-radius:10px;padding:32px">
    <div style="color:#C9A86A;font-size:18px;margin-bottom:16px">鎏光机 · AI 剧制作平台</div>
    ${inner}
  </div>
</div>`;

export async function sendVerificationEmail(to: string, token: string) {
  const url = `${baseUrl()}/api/auth/verify?token=${encodeURIComponent(token)}`;
  await send(
    to,
    "验证你的邮箱 · 鎏光机",
    wrap(`
    <p>点击下方链接完成邮箱验证（24 小时内有效）：</p>
    <p><a href="${url}" style="color:#C9A86A">${url}</a></p>
    <p style="color:#8B8F99;font-size:12px">如果不是你本人注册，请忽略本邮件。</p>`)
  );
}

export async function sendPasswordResetEmail(to: string, token: string) {
  const url = `${baseUrl()}/reset-password?token=${encodeURIComponent(token)}`;
  await send(
    to,
    "重置密码 · 鎏光机",
    wrap(`
    <p>点击下方链接重置密码（1 小时内有效）：</p>
    <p><a href="${url}" style="color:#C9A86A">${url}</a></p>
    <p style="color:#8B8F99;font-size:12px">如果不是你本人操作，请忽略本邮件。</p>`)
  );
}
