export const metadata = { title: "隐私政策" };

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-4 text-sm leading-7 text-foreground/90">
      <h1 className="text-lg text-primary">鎏光机隐私政策</h1>
      <p>我们重视你的个人信息保护。本政策说明我们收集哪些信息、如何使用与保护。</p>
      <h2 className="font-medium">1. 我们收集的信息</h2>
      <p>
        注册信息（姓名、邮箱/手机号、加密存储的密码）；使用记录（会话与消息、生成任务、积分流水）；
        为完成 AI 生成而临时处理的素材（剧本文本、参考图）。
      </p>
      <h2 className="font-medium">2. 信息的使用</h2>
      <p>
        仅用于提供与改进服务、计费结算、安全风控与法律合规。调用第三方 AI 服务时仅传输完成该次生成所必需的内容。
      </p>
      <h2 className="font-medium">3. 存储与保护</h2>
      <p>数据存储于境内服务器，密码经 bcrypt 加密。我们采取访问控制、传输加密（HTTPS）等措施保护数据。</p>
      <h2 className="font-medium">4. 你的权利</h2>
      <p>你可随时查询、更正个人信息，或申请注销账号（积分余额请在注销前使用完毕）。</p>
      <h2 className="font-medium">5. 联系我们</h2>
      <p>如有隐私相关问题或投诉，请通过页面底部联系方式与我们联系。</p>
    </div>
  );
}
