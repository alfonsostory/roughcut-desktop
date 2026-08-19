export const FORMAT_SPEC_VERSION = "roughcut-format/0.1";

const HORIZONTAL_ANCHORS = ["left", "center", "right"];
const SECTION_ROLES = ["hook", "list_item", "body", "demo", "plug", "cta"];
const OVERLAY_ROLES = ["hook_title", "item_title", "section_label", "cta", "watermark", "other"];
const OVERLAY_CONTENT_SOURCES = ["brief_hook", "brief_list", "spoken_summary", "fixed_text"];
const OVERLAY_TIMING_STRATEGIES = ["entire_video", "per_list_item", "spoken_section", "fixed_range"];
const BOX_STYLES = ["none", "solid_bar", "outline", "bubble"];
const FONT_WEIGHTS = ["regular", "medium", "semibold", "bold", "black"];
const TEXT_CASES = ["original", "lowercase", "uppercase", "sentence"];
const CAPTION_COVERAGE = ["entire_video", "speech_only", "none"];
const CAPTION_BACKGROUNDS = ["none", "solid_bar", "stroke", "shadow"];
const CAPTION_PUNCTUATION = ["keep", "strip_terminal"];
const BROLL_ROLES = ["item_image", "cutaway", "demo_screen_recording", "product_demo", "background_loop", "other"];
const BROLL_SOURCES = ["client_provided", "stock", "screenshot", "unknown"];
const BROLL_LAYOUTS = ["fullscreen", "inset_card", "pip", "split"];
const BROLL_TIMING = ["per_list_item", "section", "fixed_range"];
const CANVAS_BACKGROUNDS = ["source_video", "broll", "solid_color", "image"];

const fontSchema = {
  type: "object",
  additionalProperties: false,
  required: ["family", "fallback", "weight", "color", "size_pct_of_height", "case"],
  properties: {
    family: {
      type: "string",
      description: "Closest widely available font to what is visible, e.g. a CapCut built-in.",
    },
    fallback: { type: ["string", "null"], description: "Second-choice font if the family is unavailable." },
    weight: { enum: FONT_WEIGHTS },
    color: { type: "string", description: "CSS hex color, e.g. #FFFFFF." },
    size_pct_of_height: {
      type: "number",
      description: "Cap height of one text line measured as a percentage of full frame height.",
    },
    case: { enum: TEXT_CASES },
  },
};

const placementSchema = {
  type: "object",
  additionalProperties: false,
  required: ["horizontal", "vertical_pct", "max_width_pct"],
  properties: {
    horizontal: { enum: HORIZONTAL_ANCHORS },
    vertical_pct: {
      type: "number",
      description: "Vertical center of the element, 0 = top edge, 100 = bottom edge of the frame.",
    },
    max_width_pct: { type: "number", description: "Maximum element width as a percentage of frame width." },
  },
};

export const FORMAT_SPEC_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["version", "canvas", "structure", "text_overlays", "captions", "broll", "audio", "notes"],
  properties: {
    version: { enum: [FORMAT_SPEC_VERSION] },
    canvas: {
      type: "object",
      additionalProperties: false,
      required: ["aspect_ratio", "background", "background_detail"],
      properties: {
        aspect_ratio: { type: "string", description: "For example 9:16." },
        background: { enum: CANVAS_BACKGROUNDS },
        background_detail: { type: ["string", "null"] },
      },
    },
    structure: {
      type: "object",
      additionalProperties: false,
      required: ["sections", "hook_text", "list_items"],
      properties: {
        sections: {
          type: "array",
          description: "Video sections in playback order.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["role", "label", "content_hint"],
            properties: {
              role: { enum: SECTION_ROLES },
              label: { type: "string" },
              content_hint: {
                type: ["string", "null"],
                description: "Spoken words or brief text that identifies where this section starts.",
              },
            },
          },
        },
        hook_text: { type: ["string", "null"], description: "Exact on-screen hook text from the client brief." },
        list_items: {
          type: "array",
          description: "Exact numbered on-screen titles from the client brief, in order, without numbers.",
          items: { type: "string" },
        },
      },
    },
    text_overlays: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["role", "content_source", "fixed_text", "placement", "box", "font", "lines_max", "numbering", "timing"],
        properties: {
          role: { enum: OVERLAY_ROLES },
          content_source: { enum: OVERLAY_CONTENT_SOURCES },
          fixed_text: { type: ["string", "null"] },
          placement: placementSchema,
          box: {
            type: "object",
            additionalProperties: false,
            required: ["style", "color", "corner_radius", "opacity_pct"],
            properties: {
              style: { enum: BOX_STYLES },
              color: { type: ["string", "null"] },
              corner_radius: { enum: ["none", "rounded", "pill", null] },
              opacity_pct: { type: ["number", "null"] },
            },
          },
          font: fontSchema,
          lines_max: { type: "integer" },
          numbering: {
            type: "object",
            additionalProperties: false,
            required: ["enabled", "format"],
            properties: {
              enabled: { type: "boolean" },
              format: { type: ["string", "null"], description: "Numbering prefix pattern, e.g. \"1. \"." },
            },
          },
          timing: {
            type: "object",
            additionalProperties: false,
            required: ["strategy", "hold_seconds"],
            properties: {
              strategy: { enum: OVERLAY_TIMING_STRATEGIES },
              hold_seconds: {
                type: ["number", "null"],
                description: "Fixed on-screen duration; null means hold for the whole matched section.",
              },
            },
          },
        },
      },
    },
    captions: {
      type: "object",
      additionalProperties: false,
      required: [
        "enabled", "coverage", "font", "placement", "background",
        "words_per_cue_min", "words_per_cue_max", "keyword_quotes", "punctuation",
      ],
      properties: {
        enabled: { type: "boolean" },
        coverage: { enum: CAPTION_COVERAGE },
        font: fontSchema,
        placement: placementSchema,
        background: {
          type: "object",
          additionalProperties: false,
          required: ["style", "color"],
          properties: {
            style: { enum: CAPTION_BACKGROUNDS },
            color: { type: ["string", "null"] },
          },
        },
        words_per_cue_min: { type: "integer" },
        words_per_cue_max: { type: "integer" },
        keyword_quotes: {
          type: "array",
          description: "Words that must appear wrapped in quotation marks, e.g. a comment keyword.",
          items: { type: "string" },
        },
        punctuation: { enum: CAPTION_PUNCTUATION },
      },
    },
    broll: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["role", "source", "layout", "audio_muted", "speed_multiplier", "timing", "notes"],
        properties: {
          role: { enum: BROLL_ROLES },
          source: { enum: BROLL_SOURCES },
          layout: {
            type: "object",
            additionalProperties: false,
            required: ["style", "width_pct", "vertical_center_pct", "border"],
            properties: {
              style: { enum: BROLL_LAYOUTS },
              width_pct: { type: ["number", "null"] },
              vertical_center_pct: { type: ["number", "null"] },
              border: { type: ["string", "null"] },
            },
          },
          audio_muted: { type: "boolean" },
          speed_multiplier: { type: ["number", "null"] },
          timing: {
            type: "object",
            additionalProperties: false,
            required: ["strategy", "section_label"],
            properties: {
              strategy: { enum: BROLL_TIMING },
              section_label: { type: ["string", "null"] },
            },
          },
          notes: { type: ["string", "null"] },
        },
      },
    },
    audio: {
      type: "object",
      additionalProperties: false,
      required: ["background_music", "music_notes", "keep_original_voice", "sound_effects"],
      properties: {
        background_music: { type: "boolean" },
        music_notes: { type: ["string", "null"] },
        keep_original_voice: { type: "boolean" },
        sound_effects: { type: "array", items: { type: "string" } },
      },
    },
    notes: {
      type: "array",
      description: "Observed format details the fields above cannot express.",
      items: { type: "string" },
    },
  },
};

const isPlainObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

const clampNumber = (value, minimum, maximum, fallback) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(maximum, Math.max(minimum, numeric));
};

const validateAgainst = (schema, value, location, errors) => {
  if (schema.enum) {
    if (!schema.enum.includes(value)) errors.push(`${location} must be one of ${schema.enum.filter((item) => item !== null).join(", ")}.`);
    return;
  }
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const matchesType = types.some((type) => {
    if (type === "null") return value === null;
    if (type === "array") return Array.isArray(value);
    if (type === "object") return isPlainObject(value);
    if (type === "integer") return Number.isInteger(value);
    if (type === "number") return typeof value === "number" && Number.isFinite(value);
    return typeof value === type;
  });
  if (!matchesType) {
    errors.push(`${location} must be ${types.join(" or ")}.`);
    return;
  }
  if (isPlainObject(value) && schema.properties) {
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(`${location}.${key} is required.`);
    }
    for (const [key, propertyValue] of Object.entries(value)) {
      const propertySchema = schema.properties[key];
      if (!propertySchema) {
        errors.push(`${location}.${key} is not part of the format spec.`);
        continue;
      }
      validateAgainst(propertySchema, propertyValue, `${location}.${key}`, errors);
    }
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((item, index) => validateAgainst(schema.items, item, `${location}[${index}]`, errors));
  }
};

export function validateFormatSpec(value) {
  const errors = [];
  if (!isPlainObject(value)) return { valid: false, errors: ["Format spec must be an object."] };
  validateAgainst(FORMAT_SPEC_JSON_SCHEMA, value, "spec", errors);
  return { valid: errors.length === 0, errors };
}

export function normalizeFormatSpec(value) {
  const { valid, errors } = validateFormatSpec(value);
  if (!valid) {
    throw new Error(`Invalid format spec: ${errors.slice(0, 5).join(" ")}`);
  }
  const spec = structuredClone(value);
  spec.structure.list_items = spec.structure.list_items.map((item) => String(item).trim()).filter(Boolean);
  spec.captions.words_per_cue_min = clampNumber(spec.captions.words_per_cue_min, 1, 12, 1);
  spec.captions.words_per_cue_max = clampNumber(
    spec.captions.words_per_cue_max,
    spec.captions.words_per_cue_min,
    12,
    Math.max(4, spec.captions.words_per_cue_min),
  );
  spec.captions.keyword_quotes = spec.captions.keyword_quotes.map((word) => String(word).trim()).filter(Boolean);
  for (const overlay of spec.text_overlays) {
    overlay.placement.vertical_pct = clampNumber(overlay.placement.vertical_pct, 0, 100, 50);
    overlay.placement.max_width_pct = clampNumber(overlay.placement.max_width_pct, 10, 100, 90);
    overlay.font.size_pct_of_height = clampNumber(overlay.font.size_pct_of_height, 0.5, 25, 4);
    overlay.lines_max = Math.max(1, Math.trunc(overlay.lines_max) || 1);
  }
  spec.captions.placement.vertical_pct = clampNumber(spec.captions.placement.vertical_pct, 0, 100, 88);
  spec.captions.placement.max_width_pct = clampNumber(spec.captions.placement.max_width_pct, 10, 100, 90);
  spec.captions.font.size_pct_of_height = clampNumber(spec.captions.font.size_pct_of_height, 0.5, 25, 3.2);
  for (const slot of spec.broll) {
    if (slot.speed_multiplier !== null) {
      slot.speed_multiplier = clampNumber(slot.speed_multiplier, 0.25, 16, 1);
    }
  }
  return spec;
}
