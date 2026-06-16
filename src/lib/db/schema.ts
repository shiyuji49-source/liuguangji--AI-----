import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  bigint,
  boolean,
  integer,
  numeric,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ===== 平台角色与状态 =====
// 平台角色：注册默认 member；admin 在后台调整为 导演/分镜师/美术师/后期/管理员
export type PlatformRole = "member" | "director" | "storyboard" | "artist" | "post" | "admin";
// 项目内角色（导演邀请时指定）
export type ProjectRole = "director" | "storyboard" | "artist" | "post";
export type UserStatus = "active" | "banned";
export type ProjectTier = "B" | "A" | "S";
export type ProductionType = "真人" | "3D" | "2D";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    passwordHash: text("password_hash").notNull(),
    role: text("role").$type<PlatformRole>().notNull().default("member"),
    status: text("status").$type<UserStatus>().notNull().default("active"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email), uniqueIndex("users_phone_idx").on(t.phone)]
);

// 邮箱验证 / 找回密码 / 短信验证码
export const verificationTokens = pgTable(
  "verification_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identifier: text("identifier").notNull(), // 邮箱或手机号
    token: text("token").notNull(),
    type: text("type").$type<"email_verify" | "password_reset" | "sms_code">().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("vt_identifier_idx").on(t.identifier, t.type), uniqueIndex("vt_token_idx").on(t.token)]
);

// 项目 = 配置中枢（§ 重构）：建项目时定下的全局创作规格，下沉到所有应用。
// 级联范式：项目存默认值；应用读默认、单次可覆盖（不回写项目）；运行时注入 skill。
export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  tier: text("tier").$type<ProjectTier>().notNull().default("B"), // 级别 B/A/S：分镜取舍、视频骨架（即时生效）
  aspect: text("aspect").notNull().default("9:16"), // 画幅：构图/出图规格（即时生效）
  productionType: text("production_type").$type<ProductionType>().notNull().default("真人"), // 制作类型（P1 出图时编译为模型族；现为软提示）
  styleGenre: text("style_genre"), // 风格/题材（skill 多从剧本自动推导；现为软提示+元数据）
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memberships = pgTable(
  "memberships",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    projectRole: text("project_role").$type<ProjectRole>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.projectId] })]
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").references(() => projects.id),
    appKey: text("app_key").notNull(), // script-doctor | prompt-studio | ...
    mode: text("mode"), // prompt-studio：人物|服装|道具|场景|群演|静帧|视频
    title: text("title").notNull().default("新会话"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("conv_owner_idx").on(t.createdBy, t.appKey), index("conv_project_idx").on(t.projectId)]
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id),
    role: text("role").$type<"user" | "assistant" | "system">().notNull(),
    content: text("content").notNull(),
    attachments: jsonb("attachments"), // [{name,type,text?|dataUrl?}]
    meta: jsonb("meta"), // {costCredits, usage:{inputTokens,outputTokens,cacheReadTokens,cacheWriteTokens}, model}
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("msg_conv_idx").on(t.conversationId, t.createdAt)]
);

export type ArtifactType =
  | "剧本"
  | "诊断报告"
  | "剧本诊断"
  | "影视化剧本"
  | "资产清单"
  | "资产提示词"
  | "静帧提示词"
  | "视频提示词";

export const artifacts = pgTable(
  "artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").references(() => projects.id),
    type: text("type").$type<ArtifactType>().notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    sourceConversationId: uuid("source_conversation_id").references(() => conversations.id),
    version: integer("version").notNull().default(1),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("artifact_project_idx").on(t.projectId, t.type)]
);

// ===== 项目剧本（剧本医生工作台：剧本住在项目里，上传一次贯穿全程）=====
export const scripts = pgTable(
  "scripts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    title: text("title").notNull(),
    filename: text("filename").notNull(),
    episodeCount: integer("episode_count").notNull(),
    totalChars: integer("total_chars").notNull(),
    warnings: jsonb("warnings"), // 分集时的提示（如未发现分集标记）
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("script_project_idx").on(t.projectId, t.createdAt)]
);

export const scriptEpisodes = pgTable(
  "script_episodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scriptId: uuid("script_id")
      .notNull()
      .references(() => scripts.id),
    episodeNo: integer("episode_no").notNull(),
    title: text("title").notNull().default(""),
    content: text("content").notNull(),
    chars: integer("chars").notNull(),
  },
  (t) => [index("episode_script_idx").on(t.scriptId, t.episodeNo)]
);

// ===== 提示词生成器：卡片式生产（提取 → 生成）=====
// 非对话模型：从剧本/集「提取」出条目（资产/关键帧/镜头），每条「生成」对应类型的提示词。
export type PromptWorkspace = "资产" | "静帧" | "视频";
export type PromptItemState = "empty" | "generating" | "done" | "failed";

export const promptItems = pgTable(
  "prompt_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    workspace: text("workspace").$type<PromptWorkspace>().notNull(),
    kind: text("kind").notNull(), // 资产: 人物|服装|道具|场景|群演；静帧:静帧；视频:视频
    name: text("name").notNull(), // 资产名 / 镜头标签（如 @木兰 / 第3集-镜2）
    brief: text("brief").notNull().default(""), // 提取出的一句话描述/镜头摘要
    episodes: jsonb("episodes"), // 资产：出现的集数 [1,3,5]（审核/归纳用）
    episodeNo: integer("episode_no"), // 静帧/视频：来源集
    scriptId: uuid("script_id").references(() => scripts.id),
    promptText: text("prompt_text"), // 生成的提示词
    params: jsonb("params"), // {aspect, model, usage...}
    state: text("state").$type<PromptItemState>().notNull().default("empty"),
    error: text("error"),
    sortIndex: integer("sort_index").notNull().default(0),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("prompt_item_idx").on(t.projectId, t.workspace, t.episodeNo)]
);

// ===== 分镜表（shotlist，一等公民）：静帧/视频提示词都从 shot 行上生成 =====
export type ShotPromptState = "empty" | "generating" | "done" | "failed";

export const shots = pgTable(
  "shots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    scriptId: uuid("script_id")
      .notNull()
      .references(() => scripts.id),
    episodeNo: integer("episode_no").notNull(),
    shotNo: integer("shot_no").notNull(), // 镜号（排序）
    sceneLabel: text("scene_label").notNull().default(""), // 场（如 3-1 破庙外·黄昏）
    summary: text("summary").notNull().default(""), // 画面/动作摘要
    shotFunction: text("shot_function").notNull().default(""), // 镜头类型：建立/对话/反应/插入/空镜/POV/转场/动作
    shotType: text("shot_type").notNull().default(""), // 景别
    cameraMove: text("camera_move").notNull().default(""), // 运镜
    dialogue: text("dialogue").notNull().default(""), // 台词/声音
    durationSec: integer("duration_sec"), // 预估时长（秒）
    assetRefs: jsonb("asset_refs"), // ["@木兰","@横刀"] 关联资产名
    needStill: boolean("need_still").notNull().default(true), // 静帧取舍（B 级可关，skill 分级规则）
    stillPrompt: text("still_prompt"),
    stillState: text("still_state").$type<ShotPromptState>().notNull().default("empty"),
    stillError: text("still_error"),
    videoPrompt: text("video_prompt"),
    videoState: text("video_state").$type<ShotPromptState>().notNull().default("empty"),
    videoError: text("video_error"),
    params: jsonb("params"), // {stillCredits, videoCredits, usage...}
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("shot_scope_idx").on(t.projectId, t.scriptId, t.episodeNo, t.shotNo)]
);

// ===== 视频片段（多镜合并）：一条提示词 = 一个 ≤15 秒片段，内含分镜表的若干相邻镜 =====
export const videoSegments = pgTable(
  "video_segments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    scriptId: uuid("script_id")
      .notNull()
      .references(() => scripts.id),
    episodeNo: integer("episode_no").notNull(),
    segmentNo: integer("segment_no").notNull(),
    label: text("label").notNull().default(""), // 片段一句话标签
    shotNos: jsonb("shot_nos").notNull(), // [2,3,4] 本片段包含的镜号（相邻、同场、情绪连续）
    durationSec: integer("duration_sec"), // 目标时长（≤15）
    prompt: text("prompt"),
    state: text("state").$type<ShotPromptState>().notNull().default("empty"),
    error: text("error"),
    params: jsonb("params"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("segment_scope_idx").on(t.projectId, t.scriptId, t.episodeNo, t.segmentNo)]
);

// ===== P1 资产墙（按 §5 一次建全）=====
export type AssetKind = "人物" | "服装" | "道具" | "场景" | "群演" | "静帧" | "视频" | "参考";

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    kind: text("kind").$type<AssetKind>().notNull(),
    atName: text("at_name").notNull(), // @名
    episode: integer("episode"),
    filePath: text("file_path").notNull(),
    thumbPath: text("thumb_path"),
    meta: jsonb("meta"), // {prompt, params, sourceTaskId...}
    directorApproved: boolean("director_approved").notNull().default(false), // 纯标签，不做卡点
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("asset_project_idx").on(t.projectId, t.kind)]
);

// ===== P1/P2 生成任务 =====
export const genTasks = pgTable(
  "gen_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    appKey: text("app_key").$type<"image" | "video">().notNull(),
    status: text("status").$type<"queued" | "running" | "succeeded" | "failed">().notNull().default("queued"),
    input: jsonb("input").notNull(),
    providerTaskId: text("provider_task_id"),
    resultAssetIds: jsonb("result_asset_ids"),
    error: text("error"),
    costCredits: bigint("cost_credits", { mode: "number" }).notNull().default(0),
    providerCostEst: jsonb("provider_cost_est"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("gen_task_project_idx").on(t.projectId, t.status)]
);

// ===== 积分计费（§6）=====
export const wallets = pgTable("wallets", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id),
  balanceCredits: bigint("balance_credits", { mode: "number" }).notNull().default(0),
});

export type LedgerReason = "llm" | "image" | "video" | "recharge" | "admin_adjust" | "refund";

export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    deltaCredits: bigint("delta_credits", { mode: "number" }).notNull(),
    balanceAfter: bigint("balance_after", { mode: "number" }).notNull(),
    reason: text("reason").$type<LedgerReason>().notNull(),
    ref: jsonb("ref"), // {appKey, conversationId?, taskId?, usage细目, model, note?}
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ledger_user_idx").on(t.userId, t.createdAt)]
);

export const pricingConfig = pgTable("pricing_config", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: uuid("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rechargeOrders = pgTable(
  "recharge_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    amountYuan: numeric("amount_yuan", { precision: 12, scale: 2 }).notNull(),
    credits: bigint("credits", { mode: "number" }).notNull(),
    channel: text("channel").$type<"manual" | "wechat" | "alipay">().notNull(),
    status: text("status").$type<"pending" | "paid" | "failed">().notNull().default("pending"),
    outTradeNo: text("out_trade_no"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("recharge_user_idx").on(t.userId, t.createdAt)]
);
