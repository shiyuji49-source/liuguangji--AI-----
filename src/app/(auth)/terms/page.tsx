export const metadata = { title: "用户协议" };

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-4 text-sm leading-7 text-foreground/90">
      <h1 className="text-lg text-primary">鎏光机用户协议</h1>
      <p>欢迎使用鎏光机 · AI 剧制作平台（下称「本平台」）。注册或使用本平台即表示你同意本协议。</p>
      <h2 className="font-medium">1. 账号</h2>
      <p>你应提供真实有效的注册信息并妥善保管账号密码。账号仅限本人/本团队使用，不得转让或出售。</p>
      <h2 className="font-medium">2. 积分与充值</h2>
      <p>
        平台服务按积分计费（1 元 = 100 积分）。积分用于平台内 AI 生成服务的消耗，不可提现、不可转赠。
        每次消耗按实际用量结算并在钱包流水中可查。生成失败的任务不扣积分（已预扣的将退回）。
      </p>
      <h2 className="font-medium">3. 内容与知识产权</h2>
      <p>
        你上传的剧本等素材的权利归你所有，平台仅为完成服务进行必要处理。你应保证上传与生成行为不侵犯他人权利，
        不得利用本平台制作、传播违反法律法规的内容。
      </p>
      <h2 className="font-medium">4. 服务变更与终止</h2>
      <p>平台可对功能与定价进行调整（定价调整不影响已消耗部分）。对违反本协议的账号，平台有权限制或停用。</p>
      <h2 className="font-medium">5. 免责</h2>
      <p>AI 生成内容由模型自动产生，平台不保证其准确性与适用性，请在使用前自行审核。</p>
      <h2 className="font-medium">6. 投诉与联系</h2>
      <p>对平台内容如有投诉，请通过页面底部联系方式与我们联系，我们将及时处理。</p>
    </div>
  );
}
