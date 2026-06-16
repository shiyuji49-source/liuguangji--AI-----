# 鎏光机生产镜像（多阶段）：
#   builder —— 完整依赖，负责 next build 与数据库迁移（compose 的 migrate 服务用这层）
#   runner  —— 只带 standalone 产物，体积小、攻击面小
FROM node:22-alpine AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS builder
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# 构建期不连库：平台页已 force-dynamic，构建只产静态壳
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
# standalone 含 server.js + 按需裁剪的 node_modules
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# skill 文件运行时读取（outputFileTracingIncludes 已声明，双保险显式拷贝）
COPY --from=builder /app/docs/鎏光智绘提示词SKILL ./docs/鎏光智绘提示词SKILL
# 生成产物目录（挂载卷 mountpoint）：预建并归属非 root 运行用户。
# 否则新命名卷默认 root:root，非 root 的 app 用户写图 EACCES → 路由抛无 status 异常 → "服务器内部错误"。
# 命名卷首次挂载会从镜像该目录初始化并继承 app:app 属主。
RUN mkdir -p /data/assets && chown -R app:app /data/assets
USER app
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
