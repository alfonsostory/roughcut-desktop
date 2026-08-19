export interface FormatFont {
  family: string;
  fallback: string | null;
  weight: "regular" | "medium" | "semibold" | "bold" | "black";
  color: string;
  size_pct_of_height: number;
  case: "original" | "lowercase" | "uppercase" | "sentence";
}

export interface FormatPlacement {
  horizontal: "left" | "center" | "right";
  vertical_pct: number;
  max_width_pct: number;
}

export interface FormatTextOverlay {
  role: "hook_title" | "item_title" | "section_label" | "cta" | "watermark" | "other";
  content_source: "brief_hook" | "brief_list" | "spoken_summary" | "fixed_text";
  fixed_text: string | null;
  placement: FormatPlacement;
  box: {
    style: "none" | "solid_bar" | "outline" | "bubble";
    color: string | null;
    corner_radius: "none" | "rounded" | "pill" | null;
    opacity_pct: number | null;
  };
  font: FormatFont;
  lines_max: number;
  numbering: { enabled: boolean; format: string | null };
  timing: {
    strategy: "entire_video" | "per_list_item" | "spoken_section" | "fixed_range";
    hold_seconds: number | null;
  };
}

export interface FormatBrollSlot {
  role: "item_image" | "cutaway" | "demo_screen_recording" | "product_demo" | "background_loop" | "other";
  source: "client_provided" | "stock" | "screenshot" | "unknown";
  layout: {
    style: "fullscreen" | "inset_card" | "pip" | "split";
    width_pct: number | null;
    vertical_center_pct: number | null;
    border: string | null;
  };
  audio_muted: boolean;
  speed_multiplier: number | null;
  timing: { strategy: "per_list_item" | "section" | "fixed_range"; section_label: string | null };
  notes: string | null;
}

export interface FormatSpec {
  version: string;
  canvas: {
    aspect_ratio: string;
    background: "source_video" | "broll" | "solid_color" | "image";
    background_detail: string | null;
  };
  structure: {
    sections: Array<{
      role: "hook" | "list_item" | "body" | "demo" | "plug" | "cta";
      label: string;
      content_hint: string | null;
    }>;
    hook_text: string | null;
    list_items: string[];
  };
  text_overlays: FormatTextOverlay[];
  captions: {
    enabled: boolean;
    coverage: "entire_video" | "speech_only" | "none";
    font: FormatFont;
    placement: FormatPlacement;
    background: { style: "none" | "solid_bar" | "stroke" | "shadow"; color: string | null };
    words_per_cue_min: number;
    words_per_cue_max: number;
    keyword_quotes: string[];
    punctuation: "keep" | "strip_terminal";
  };
  broll: FormatBrollSlot[];
  audio: {
    background_music: boolean;
    music_notes: string | null;
    keep_original_voice: boolean;
    sound_effects: string[];
  };
  notes: string[];
}

export const FORMAT_SPEC_VERSION: string;
export const FORMAT_SPEC_JSON_SCHEMA: Record<string, unknown>;
export function validateFormatSpec(value: unknown): { valid: boolean; errors: string[] };
export function normalizeFormatSpec(value: unknown): FormatSpec;
