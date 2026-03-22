import type { TemplateCategory } from "../types/template";

export interface TemplateCategoryMeta {
  id: TemplateCategory;
  label: string;
  description: string;
  bestFor: string[];
  autoSelectRules: string[];
}

export const TEMPLATE_CATEGORY_META: Record<TemplateCategory, TemplateCategoryMeta> = {
  talking_head: {
    id: "talking_head",
    label: "Talking Head",
    description: "Face-tracked zoom with animated captions",
    bestFor: ["Podcasts", "Interviews", "Commentary", "Hot takes", "Advice"],
    autoSelectRules: ["Prominent single face + speech detected"],
  },
  gameplay: {
    id: "gameplay",
    label: "Gameplay + Face",
    description: "Split-screen gameplay top, face cam bottom",
    bestFor: ["Story time", "Reddit readings", "True crime", "Hot takes"],
    autoSelectRules: ["User manually sets B-roll"],
  },
  podcast: {
    id: "podcast",
    label: "Podcast Visualizer",
    description: "Audio waveform visualizer with speaker info",
    bestFor: ["Audio-only podcasts", "Voice tweets", "Voice memos"],
    autoSelectRules: ["Source is audio-only or podcast RSS"],
  },
  tutorial: {
    id: "tutorial",
    label: "Tutorial",
    description: "Step-by-step format with cursor zoom and callouts",
    bestFor: ["How-to", "Tech tips", "Cooking", "DIY", "Life hacks"],
    autoSelectRules: ["Source is screen recording"],
  },
  reaction: {
    id: "reaction",
    label: "Reaction",
    description: "Side-by-side reaction format",
    bestFor: ["Reaction content", "Duets", "Commentary"],
    autoSelectRules: ["Source has multiple face tracks"],
  },
  meme: {
    id: "meme",
    label: "Meme Format",
    description: "Bold impact text top/bottom over video",
    bestFor: ["Humor", "Relatable content", "Reaction memes"],
    autoSelectRules: ["Humor emotion tag + quotability > 0.8"],
  },
  cinematic: {
    id: "cinematic",
    label: "Cinematic",
    description: "Letterbox, color grade, dramatic zoom",
    bestFor: ["Travel", "Nature", "Luxury", "Food", "Motivation"],
    autoSelectRules: ["High visual dynamism + low speech"],
  },
  text_story: {
    id: "text_story",
    label: "Kinetic Text",
    description: "Full-screen animated text reveals",
    bestFor: ["Facts", "Quotes", "Confessions", "Controversial takes"],
    autoSelectRules: ["Text-heavy content with no face"],
  },
};
