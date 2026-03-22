import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  integer,
  bigint,
  real,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  check,
  foreignKey,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { customType } from "drizzle-orm/pg-core";

// ──────────────────────────────────────────────────────────────
// Custom pgvector type
// ──────────────────────────────────────────────────────────────
const vector = (name: string, dimensions: number) =>
  customType<{ data: number[]; driverData: string }>({
    dataType() {
      return `vector(${dimensions})`;
    },
    toDriver(value: number[]) {
      return `[${value.join(",")}]`;
    },
    fromDriver(value: string) {
      return value
        .replace(/[\[\]]/g, "")
        .split(",")
        .map(Number);
    },
  })(name);

// ──────────────────────────────────────────────────────────────
// Enums
// ──────────────────────────────────────────────────────────────
export const userPlanEnum = pgEnum("user_plan", ["free", "pro", "agency"]);

export const platformEnum = pgEnum("platform", [
  "tiktok",
  "instagram",
  "youtube",
  "twitter",
  "facebook",
  "snapchat",
  "linkedin",
  "pinterest",
]);

export const sourceTypeEnum = pgEnum("source_type", [
  "upload",
  "youtube_url",
  "twitch_vod",
  "podcast_rss",
  "screen_recording",
  "live_stream",
]);

export const mediaProcessingStatusEnum = pgEnum("media_processing_status", [
  "uploading",
  "transcribing",
  "analyzing",
  "ready",
  "error",
]);

export const clipStatusEnum = pgEnum("clip_status", [
  "detected",
  "queued",
  "rendering",
  "rendered",
  "published",
  "failed",
]);

export const publicationStatusEnum = pgEnum("publication_status", [
  "draft",
  "scheduled",
  "publishing",
  "published",
  "failed",
]);

export const templateCategoryEnum = pgEnum("template_category", [
  "talking_head",
  "gameplay",
  "podcast",
  "tutorial",
  "reaction",
  "meme",
  "cinematic",
  "text_story",
]);

// ──────────────────────────────────────────────────────────────
// Tables
// ──────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  avatarUrl: text("avatar_url"),
  plan: userPlanEnum("plan").default("free").notNull(),
  apiKey: varchar("api_key", { length: 64 }).unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const socialAccounts = pgTable(
  "social_accounts",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    platform: platformEnum("platform").notNull(),
    platformUserId: varchar("platform_user_id", { length: 255 }).notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    username: varchar("username", { length: 255 }),
    followerCount: integer("follower_count").default(0).notNull(),
    connectedAt: timestamp("connected_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userPlatformUnique: uniqueIndex("social_accounts_user_platform_unique").on(
      t.userId,
      t.platform
    ),
  })
);

export const sourceMedia = pgTable("source_media", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 500 }),
  sourceType: sourceTypeEnum("source_type").notNull(),
  sourceUrl: text("source_url"),
  s3Key: text("s3_key"),
  durationSeconds: real("duration_seconds"),
  resolution: varchar("resolution", { length: 20 }),
  fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
  transcript: text("transcript"),
  transcriptSegments: jsonb("transcript_segments"),
  sceneGraph: jsonb("scene_graph"),
  processingStatus: mediaProcessingStatusEnum("processing_status")
    .default("uploading")
    .notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const templates = pgTable("templates", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull(),
  category: templateCategoryEnum("category"),
  thumbnailUrl: text("thumbnail_url"),
  remotionCompositionId: varchar("remotion_composition_id", { length: 255 }),
  config: jsonb("config").notNull(),
  viralityAvg: real("virality_avg"),
  isSystem: boolean("is_system").default(true).notNull(),
  userId: uuid("user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const clips = pgTable(
  "clips",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sourceMediaId: uuid("source_media_id")
      .notNull()
      .references(() => sourceMedia.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 500 }),
    startTime: real("start_time").notNull(),
    endTime: real("end_time").notNull(),
    durationSeconds: real("duration_seconds").notNull(),
    viralityScore: real("virality_score"),
    hookScore: real("hook_score"),
    energyScore: real("energy_score"),
    emotionTags: jsonb("emotion_tags"),
    transcriptSnippet: text("transcript_snippet"),
    templateId: uuid("template_id").references(() => templates.id),
    overlayConfig: jsonb("overlay_config"),
    status: clipStatusEnum("status").default("detected").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    durationCheck: check(
      "clips_duration_check",
      sql`${t.durationSeconds} <= 30`
    ),
    userIdIdx: index("clips_user_id_idx").on(t.userId),
    sourceMediaIdx: index("clips_source_media_idx").on(t.sourceMediaId),
    viralityScoreIdx: index("clips_virality_score_idx").on(t.viralityScore),
  })
);

export const renderedClips = pgTable("rendered_clips", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  clipId: uuid("clip_id")
    .notNull()
    .references(() => clips.id, { onDelete: "cascade" }),
  platform: varchar("platform", { length: 50 }).notNull(),
  s3Key: text("s3_key").notNull(),
  cdnUrl: text("cdn_url"),
  fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
  resolution: varchar("resolution", { length: 20 }),
  codec: varchar("codec", { length: 20 }),
  bitrate: varchar("bitrate", { length: 10 }),
  thumbnailUrl: text("thumbnail_url"),
  renderedAt: timestamp("rendered_at", { withTimezone: true }).defaultNow().notNull(),
});

export const publications = pgTable("publications", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  renderedClipId: uuid("rendered_clip_id")
    .notNull()
    .references(() => renderedClips.id, { onDelete: "cascade" }),
  socialAccountId: uuid("social_account_id")
    .notNull()
    .references(() => socialAccounts.id, { onDelete: "cascade" }),
  platformPostId: varchar("platform_post_id", { length: 255 }),
  caption: text("caption"),
  hashtags: jsonb("hashtags"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  status: publicationStatusEnum("status").default("draft").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const analytics = pgTable(
  "analytics",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    publicationId: uuid("publication_id")
      .notNull()
      .references(() => publications.id, { onDelete: "cascade" }),
    views: integer("views").default(0).notNull(),
    likes: integer("likes").default(0).notNull(),
    comments: integer("comments").default(0).notNull(),
    shares: integer("shares").default(0).notNull(),
    saves: integer("saves").default(0).notNull(),
    watchTimeSeconds: real("watch_time_seconds").default(0).notNull(),
    avgWatchPercentage: real("avg_watch_percentage").default(0).notNull(),
    reach: integer("reach").default(0).notNull(),
    engagementRate: real("engagement_rate").default(0).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    publicationFetchedIdx: index("analytics_publication_fetched_idx").on(
      t.publicationId,
      t.fetchedAt
    ),
  })
);

export const trendingSounds = pgTable("trending_sounds", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  platform: varchar("platform", { length: 50 }).notNull(),
  soundName: varchar("sound_name", { length: 500 }),
  artist: varchar("artist", { length: 255 }),
  soundUrl: text("sound_url"),
  usageCount: bigint("usage_count", { mode: "number" }),
  trendingRank: integer("trending_rank"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
});

export const trendingHashtags = pgTable("trending_hashtags", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  platform: varchar("platform", { length: 50 }).notNull(),
  hashtag: varchar("hashtag", { length: 255 }).notNull(),
  volume: bigint("volume", { mode: "number" }),
  velocity: real("velocity"),
  category: varchar("category", { length: 100 }),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
});

export const viralityFeedbackLoop = pgTable("virality_feedback_loop", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  clipId: uuid("clip_id")
    .notNull()
    .references(() => clips.id),
  predictedVirality: real("predicted_virality").notNull(),
  actualTotalViews: integer("actual_total_views"),
  actualEngagementRate: real("actual_engagement_rate"),
  featuresVector: vector("features_vector", 512),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ──────────────────────────────────────────────────────────────
// Relations
// ──────────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ many }) => ({
  socialAccounts: many(socialAccounts),
  sourceMedia: many(sourceMedia),
  clips: many(clips),
  templates: many(templates),
}));

export const socialAccountsRelations = relations(socialAccounts, ({ one, many }) => ({
  user: one(users, { fields: [socialAccounts.userId], references: [users.id] }),
  publications: many(publications),
}));

export const sourceMediaRelations = relations(sourceMedia, ({ one, many }) => ({
  user: one(users, { fields: [sourceMedia.userId], references: [users.id] }),
  clips: many(clips),
}));

export const clipsRelations = relations(clips, ({ one, many }) => ({
  user: one(users, { fields: [clips.userId], references: [users.id] }),
  sourceMedia: one(sourceMedia, {
    fields: [clips.sourceMediaId],
    references: [sourceMedia.id],
  }),
  template: one(templates, { fields: [clips.templateId], references: [templates.id] }),
  renderedClips: many(renderedClips),
  feedbackLoop: many(viralityFeedbackLoop),
}));

export const renderedClipsRelations = relations(renderedClips, ({ one, many }) => ({
  clip: one(clips, { fields: [renderedClips.clipId], references: [clips.id] }),
  publications: many(publications),
}));

export const publicationsRelations = relations(publications, ({ one, many }) => ({
  renderedClip: one(renderedClips, {
    fields: [publications.renderedClipId],
    references: [renderedClips.id],
  }),
  socialAccount: one(socialAccounts, {
    fields: [publications.socialAccountId],
    references: [socialAccounts.id],
  }),
  analytics: many(analytics),
}));

export const analyticsRelations = relations(analytics, ({ one }) => ({
  publication: one(publications, {
    fields: [analytics.publicationId],
    references: [publications.id],
  }),
}));

export const viralityFeedbackLoopRelations = relations(
  viralityFeedbackLoop,
  ({ one }) => ({
    clip: one(clips, {
      fields: [viralityFeedbackLoop.clipId],
      references: [clips.id],
    }),
  })
);
