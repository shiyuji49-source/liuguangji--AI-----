# 鎏光机平台

- 先读 docs/本规划书.md；开头产品铁律不可违背。
- 新增应用 = src/apps/ 新目录 + src/apps/registry.ts 注册；应用间禁止互相 import 业务代码（唯一例外：剧本医生的"资产清单"产物可被提示词生成器读取带入，经 artifacts 表，不直接 import）。
- 系统提示词一律经 src/lib/ai/skills.ts 从 docs/鎏光智绘提示词SKILL/ 拼装，禁止改写 skill 内容。
- 一切外部 API 消耗必须经 src/lib/billing/charge.ts 扣积分并写流水；禁止绕过计费直调 provider。
- UI 用规划书 §12 设计 tokens（已落在 src/app/globals.css）；不引入新 UI 库。
- 每完成一个验收项跑 `npm run lint` + `npm run build` + 手测。

## 技术栈
Next.js 16 (App Router) + TypeScript + Tailwind v4 + shadcn/ui；PostgreSQL 16 + Drizzle ORM（pg Pool max=20）；Auth.js (NextAuth v5) credentials；AI SDK v6 + @ai-sdk/anthropic（baseURL=乐奇API，Bearer 鉴权可切换）。

## 常用命令
- `npm run dev` 开发
- `npm run build` 构建（验收必过）
- `npm run lint` 代码检查
- `npm run db:generate` / `npm run db:migrate` Drizzle 迁移
- `npm run db:seed` 种子数据（管理员账号 + 默认定价表）

## 模型路由（env 可换）
- 剧本医生 = `LLM_MODEL_HEAVY`（默认 claude-opus-4-8）
- 其余一切 = `LLM_MODEL_MAIN`（默认 claude-sonnet-4-6）
- skill 系统提示词块必须带 `cache_control: {"type":"ephemeral"}`
