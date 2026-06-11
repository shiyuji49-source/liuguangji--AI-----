import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["pdf-parse", "mammoth", "bcryptjs", "pg"],
  outputFileTracingIncludes: {
    // skill 文件随部署产物打包，lib/ai/skills.ts 启动时读取
    "/**": ["./docs/鎏光智绘提示词SKILL/**"],
  },
};

export default nextConfig;
