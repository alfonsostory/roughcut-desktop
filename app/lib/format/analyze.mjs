import { FORMAT_SPEC_JSON_SCHEMA, normalizeFormatSpec } from "./spec.mjs";

export const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
export const DEFAULT_FORMAT_MODEL = "gpt-5";

const ANALYSIS_INSTRUCTIONS = [
  "You are a senior short-form video editor replicating a client's inspiration video.",
  "You receive evenly spaced still frames from the inspiration video plus the client's written brief.",
  "Produce one format spec that lets an editor rebuild this exact visual format for new footage.",
  "",
  "Do not classify the video into a known template. Measure what is actually visible:",
  "- For every distinct on-screen text element: position of its vertical center as a percentage of frame height, horizontal anchor, width, background box shape and color, text color, letter case, and line count.",
  "- Estimate each text element's font by its visible characteristics (serif/sans, weight, roundness) and name the closest widely available match, preferring CapCut built-in fonts; give a fallback.",
  "- Estimate font size as the cap height of one line measured against full frame height.",
  "- For captions: count the words shown per caption cue across several frames and report the minimum and maximum, their position, and styling.",
  "- For inserted images or b-roll: how they are composed (full screen, inset card over the base video, picture-in-picture), their width and position, whether their audio could be audible, and when they appear relative to the spoken structure.",
  "- Reconstruct the video's structure as ordered sections (hook, list items, demo, plug, cta) from the frames and the brief.",
  "",
  "The client brief is authoritative: whenever the brief states an explicit constraint (exact on-screen titles, fonts, captions coverage, background music, muted or sped-up clips, words that must carry quotation marks), copy it into the spec even if the frames alone would not show it.",
  "Copy the exact hook text into structure.hook_text and the exact numbered titles into structure.list_items in order, without their leading numbers.",
  "If the brief asks viewers to comment a specific word, put that word into captions.keyword_quotes.",
  "Record any observed format detail the schema cannot express as a plain sentence in notes.",
  "Report only what you can observe or what the brief states; use nulls rather than inventing values.",
].join("\n");

const dataUrl = (frame) => {
  if (typeof frame === "string") return frame;
  if (frame && typeof frame.dataUrl === "string") return frame.dataUrl;
  if (frame && typeof frame.base64 === "string") {
    return `data:${frame.mimeType ?? "image/jpeg"};base64,${frame.base64}`;
  }
  throw new Error("Each inspiration frame needs a data URL or base64 payload.");
};

export function buildFormatAnalysisRequest({
  brief,
  frames,
  inspirationTranscript = null,
  model = DEFAULT_FORMAT_MODEL,
  maxOutputTokens = 8000,
} = {}) {
  const briefText = String(brief ?? "").trim();
  if (!briefText) throw new Error("A client brief is required for format analysis.");
  if (!Array.isArray(frames) || !frames.length) {
    throw new Error("At least one inspiration frame is required for format analysis.");
  }

  const content = [
    { type: "input_text", text: `CLIENT BRIEF\n${briefText}` },
  ];
  if (inspirationTranscript) {
    content.push({
      type: "input_text",
      text: `INSPIRATION VIDEO TRANSCRIPT\n${String(inspirationTranscript).trim()}`,
    });
  }
  content.push({
    type: "input_text",
    text: `INSPIRATION FRAMES\nThe next ${frames.length} images are stills sampled evenly across the inspiration video, in playback order.`,
  });
  for (const frame of frames) {
    content.push({ type: "input_image", image_url: dataUrl(frame), detail: "high" });
  }

  return {
    model,
    instructions: ANALYSIS_INSTRUCTIONS,
    input: [{ role: "user", content }],
    max_output_tokens: maxOutputTokens,
    text: {
      format: {
        type: "json_schema",
        name: "roughcut_format_spec",
        strict: true,
        schema: FORMAT_SPEC_JSON_SCHEMA,
      },
    },
  };
}

const outputText = (payload) => {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }
  for (const item of payload?.output ?? []) {
    if (item?.type !== "message") continue;
    for (const part of item.content ?? []) {
      if (part?.type === "output_text" && typeof part.text === "string") return part.text;
      if (part?.type === "refusal") {
        throw new Error(`The analysis model declined the request: ${part.refusal}`);
      }
    }
  }
  return "";
};

export function parseFormatAnalysisResponse(payload) {
  if (payload?.error) {
    const message = typeof payload.error === "string" ? payload.error : payload.error.message;
    throw new Error(`OpenAI request failed: ${message ?? "unknown error"}`);
  }
  if (payload?.status === "incomplete") {
    const reason = payload?.incomplete_details?.reason ?? "unknown reason";
    throw new Error(`The analysis response is incomplete (${reason}). Try fewer frames or a larger output limit.`);
  }
  const text = outputText(payload);
  if (!text.trim()) throw new Error("The analysis response contained no format spec.");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("The analysis response was not valid JSON.");
  }
  return normalizeFormatSpec(parsed);
}

export async function requestFormatAnalysis(request, { apiKey, fetchImpl = fetch } = {}) {
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured for the local companion service.");
  }
  const response = await fetchImpl(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(request),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message ?? `OpenAI returned status ${response.status}.`;
    throw new Error(message);
  }
  return parseFormatAnalysisResponse(payload);
}
