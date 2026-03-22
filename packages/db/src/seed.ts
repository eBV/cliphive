/**
 * Database seed script.
 * Populates system templates and any required static data.
 *
 * Usage: npm run db:seed (from packages/db)
 */
import { createDb } from ".";
import { templates } from "./schema";

const DATABASE_URL = process.env["DATABASE_URL"];
if (!DATABASE_URL) throw new Error("DATABASE_URL environment variable is required");

const db = createDb(DATABASE_URL);

const SYSTEM_TEMPLATES = [
  {
    name: "Talking Head — Face Zoom",
    category: "talking_head" as const,
    remotionCompositionId: "TalkingHead",
    isSystem: true,
    config: {
      layout: "fullscreen",
      captionStyle: "tiktok_classic",
      captionPosition: "bottom",
      zoomBehavior: "auto_face_track",
      transitionType: "cut",
      brandColors: {
        primary: "#FFD700",
        secondary: "#000000",
        accent: "#FFD700",
        background: "#000000",
        text: "#FFFFFF",
      },
      musicSlot: false,
      watermark: null,
      letterbox: false,
      colorGrade: null,
      progressBar: true,
      ctaTemplate: null,
    },
  },
  {
    name: "Split Screen — Gameplay + Face",
    category: "gameplay" as const,
    remotionCompositionId: "SplitScreen",
    isSystem: true,
    config: {
      layout: "split_vertical_60_40",
      captionStyle: "tiktok_classic",
      captionPosition: "top",
      zoomBehavior: "static",
      transitionType: "cut",
      brandColors: {
        primary: "#00FF88",
        secondary: "#000000",
        accent: "#00FF88",
        background: "#000000",
        text: "#FFFFFF",
      },
      musicSlot: true,
      watermark: null,
      letterbox: false,
      colorGrade: null,
      progressBar: false,
      ctaTemplate: null,
    },
  },
  {
    name: "Podcast — Audio Visualizer",
    category: "podcast" as const,
    remotionCompositionId: "PodcastWave",
    isSystem: true,
    config: {
      layout: "fullscreen",
      captionStyle: "hormozi",
      captionPosition: "center",
      zoomBehavior: "static",
      transitionType: "fade",
      brandColors: {
        primary: "#8B5CF6",
        secondary: "#1F1F1F",
        accent: "#8B5CF6",
        background: "#0F0F0F",
        text: "#FFFFFF",
      },
      musicSlot: false,
      watermark: null,
      letterbox: false,
      colorGrade: null,
      progressBar: false,
      ctaTemplate: null,
    },
  },
  {
    name: "Kinetic Typography — Text Story",
    category: "text_story" as const,
    remotionCompositionId: "TextStory",
    isSystem: true,
    config: {
      layout: "fullscreen",
      captionStyle: "hormozi",
      captionPosition: "center",
      zoomBehavior: "static",
      transitionType: "fade",
      brandColors: {
        primary: "#FF0000",
        secondary: "#000000",
        accent: "#FFFFFF",
        background: "#000000",
        text: "#FFFFFF",
      },
      musicSlot: true,
      watermark: null,
      letterbox: false,
      colorGrade: null,
      progressBar: false,
      ctaTemplate: "Follow for more 🔥",
    },
  },
  {
    name: "Cinematic — Premium Feel",
    category: "cinematic" as const,
    remotionCompositionId: "Cinematic",
    isSystem: true,
    config: {
      layout: "fullscreen",
      captionStyle: "minimal",
      captionPosition: "bottom",
      zoomBehavior: "ken_burns",
      transitionType: "fade",
      brandColors: {
        primary: "#C9A96E",
        secondary: "#1A1A2E",
        accent: "#C9A96E",
        background: "#000000",
        text: "#F5F5DC",
      },
      musicSlot: true,
      watermark: null,
      letterbox: true,
      colorGrade: "teal_orange",
      progressBar: false,
      ctaTemplate: null,
    },
  },
  {
    name: "Tutorial — Step-by-Step",
    category: "tutorial" as const,
    remotionCompositionId: "Tutorial",
    isSystem: true,
    config: {
      layout: "fullscreen",
      captionStyle: "minimal",
      captionPosition: "bottom",
      zoomBehavior: "auto_face_track",
      transitionType: "cut",
      brandColors: {
        primary: "#3B82F6",
        secondary: "#1E293B",
        accent: "#3B82F6",
        background: "#FFFFFF",
        text: "#1E293B",
      },
      musicSlot: false,
      watermark: null,
      letterbox: false,
      colorGrade: null,
      progressBar: true,
      ctaTemplate: null,
    },
  },
  {
    name: "Meme Format — Impact Text",
    category: "meme" as const,
    remotionCompositionId: "MemeFormat",
    isSystem: true,
    config: {
      layout: "fullscreen",
      captionStyle: "tiktok_classic",
      captionPosition: "top",
      zoomBehavior: "static",
      transitionType: "cut",
      brandColors: {
        primary: "#FFFFFF",
        secondary: "#000000",
        accent: "#FFFFFF",
        background: "#000000",
        text: "#FFFFFF",
      },
      musicSlot: false,
      watermark: null,
      letterbox: false,
      colorGrade: null,
      progressBar: false,
      ctaTemplate: null,
    },
  },
  {
    name: "Reaction — Side by Side",
    category: "reaction" as const,
    remotionCompositionId: "ReactionClip",
    isSystem: true,
    config: {
      layout: "side_by_side",
      captionStyle: "tiktok_classic",
      captionPosition: "bottom",
      zoomBehavior: "auto_face_track",
      transitionType: "cut",
      brandColors: {
        primary: "#FF4500",
        secondary: "#000000",
        accent: "#FF4500",
        background: "#000000",
        text: "#FFFFFF",
      },
      musicSlot: false,
      watermark: null,
      letterbox: false,
      colorGrade: null,
      progressBar: false,
      ctaTemplate: null,
    },
  },
] as const;

async function seed() {
  console.log("🌱 Seeding database...");

  for (const template of SYSTEM_TEMPLATES) {
    await db
      .insert(templates)
      .values({
        ...template,
        config: template.config as Record<string, unknown>,
      })
      .onConflictDoNothing();
    console.log(`  ✓ Template: ${template.name}`);
  }

  console.log("✅ Seed complete.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
