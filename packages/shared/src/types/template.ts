/** Template and composition types. */
export interface Template {
  id: string;
  name: string;
  category: TemplateCategory;
  thumbnailUrl: string | null;
  remotionCompositionId: string;
  config: TemplateConfig;
  viralityAvg: number | null;
  isSystem: boolean;
  userId: string | null;
  createdAt: string;
}

export type TemplateCategory =
  | "talking_head"
  | "gameplay"
  | "podcast"
  | "tutorial"
  | "reaction"
  | "meme"
  | "cinematic"
  | "text_story";

export interface TemplateConfig {
  layout: TemplateLayout;
  captionStyle: string;
  captionPosition: "top" | "center" | "bottom";
  zoomBehavior: "static" | "auto_face_track" | "ken_burns" | "custom";
  transitionType: "cut" | "fade" | "slide" | "zoom";
  brandColors: BrandColors;
  musicSlot: boolean;
  watermark: WatermarkConfig | null;
  letterbox: boolean;
  colorGrade: ColorGrade | null;
  progressBar: boolean;
  ctaTemplate: string | null;
}

export type TemplateLayout =
  | "fullscreen"
  | "split_vertical_60_40"
  | "split_horizontal"
  | "picture_in_picture"
  | "side_by_side";

export interface BrandColors {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  text: string;
}

export interface WatermarkConfig {
  text?: string;
  logoUrl?: string;
  position: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  opacity: number;
}

export type ColorGrade =
  | "teal_orange"
  | "desaturated"
  | "high_contrast"
  | "warm"
  | "cool"
  | "none";
