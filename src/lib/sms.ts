import { createHmac } from "node:crypto";

/**
 * 手机号注册短信模块（可插拔，规划书 §2）：
 * SMS_* 环境变量齐全才启用；未配置时注册页只显示邮箱注册。
 * 阿里云短信 API（RPC 签名 V1.0），不引入官方 SDK。
 */
export function smsEnabled() {
  return Boolean(
    process.env.SMS_ACCESS_KEY_ID &&
      process.env.SMS_ACCESS_KEY_SECRET &&
      process.env.SMS_SIGN_NAME &&
      process.env.SMS_TEMPLATE_CODE
  );
}

function percentEncode(s: string) {
  return encodeURIComponent(s).replace(/\+/g, "%20").replace(/\*/g, "%2A").replace(/%7E/g, "~");
}

export async function sendSmsCode(phone: string, code: string) {
  if (!smsEnabled()) {
    console.warn(`[sms 未配置] to=${phone} code=${code}`);
    return;
  }
  const params: Record<string, string> = {
    AccessKeyId: process.env.SMS_ACCESS_KEY_ID!,
    Action: "SendSms",
    Format: "JSON",
    PhoneNumbers: phone,
    RegionId: "cn-hangzhou",
    SignName: process.env.SMS_SIGN_NAME!,
    SignatureMethod: "HMAC-SHA1",
    SignatureNonce: crypto.randomUUID(),
    SignatureVersion: "1.0",
    TemplateCode: process.env.SMS_TEMPLATE_CODE!,
    TemplateParam: JSON.stringify({ code }),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    Version: "2017-05-25",
  };
  const canonical = Object.keys(params)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`)
    .join("&");
  const stringToSign = `GET&%2F&${percentEncode(canonical)}`;
  const signature = createHmac("sha1", `${process.env.SMS_ACCESS_KEY_SECRET}&`)
    .update(stringToSign)
    .digest("base64");

  const url = `https://dysmsapi.aliyuncs.com/?Signature=${percentEncode(signature)}&${canonical}`;
  const res = await fetch(url);
  const data = (await res.json()) as { Code?: string; Message?: string };
  if (data.Code !== "OK") {
    throw new Error(`短信发送失败：${data.Message ?? data.Code}`);
  }
}
