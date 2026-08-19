const pad = (value, length = 2) => String(value).padStart(length, "0");

export function srtTimestamp(secondsValue) {
  const total = Math.max(0, secondsValue);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const wholeSeconds = Math.floor(total % 60);
  const milliseconds = Math.round((total - Math.floor(total)) * 1000);
  return `${pad(hours)}:${pad(minutes)}:${pad(wholeSeconds)},${pad(milliseconds, 3)}`;
}

export function buildCaptionsSrt(cues) {
  return cues
    .map((cue, index) => `${index + 1}\n${srtTimestamp(cue.start)} --> ${srtTimestamp(cue.end)}\n${cue.text}\n`)
    .join("\n");
}

const clock = (value) => (value === null || value === undefined
  ? "manual"
  : `${pad(Math.floor(value / 60))}:${pad(Math.floor(value % 60))}.${pad(Math.round((value - Math.floor(value)) * 10), 1)}`);

const describeFont = (font) => {
  const fallback = font.fallback ? ` (fallback: ${font.fallback})` : "";
  return `${font.family}${fallback}, ${font.weight}, ${font.color}, about ${font.size_pct_of_height}% of frame height per line, ${font.case} case`;
};

const describePlacement = (placement) =>
  `${placement.horizontal}, vertical center at ${placement.vertical_pct}% of frame height, max width ${placement.max_width_pct}%`;

const describeBox = (box) => (box.style === "none"
  ? "no background box"
  : `${box.style} background ${box.color ?? ""}${box.corner_radius && box.corner_radius !== "none" ? `, ${box.corner_radius} corners` : ""}`.trim());

export function buildFormatGuide(spec, plan, sourceName) {
  const lines = [
    "ROUGH CUT — CAPCUT FORMAT GUIDE",
    "",
    `Source: ${sourceName}`,
    "This guide was generated from the client's inspiration video and brief.",
    "Timeline times refer to the assembled segments in playback order.",
    "",
    "== TEXT OVERLAYS ==",
  ];
  for (const title of plan.titles) {
    lines.push(
      `- [${clock(title.start)} - ${clock(title.end)}] ${JSON.stringify(title.text)}`,
      `    Placement: ${describePlacement(title.placement)}`,
      `    Style: ${describeBox(title.box)}; font ${describeFont(title.font)}; up to ${title.lines_max} line(s)`,
    );
  }
  lines.push("", "== CAPTIONS ==");
  if (spec.captions.enabled) {
    lines.push(
      `- Import captions.srt (${plan.captions.length} cues, ${spec.captions.words_per_cue_min}-${spec.captions.words_per_cue_max} words per cue).`,
      `- Coverage: ${spec.captions.coverage.replace(/_/g, " ")}.`,
      `- Font: ${describeFont(spec.captions.font)}.`,
      `- Placement: ${describePlacement(spec.captions.placement)}.`,
      `- Background: ${spec.captions.background.style}${spec.captions.background.color ? ` ${spec.captions.background.color}` : ""}.`,
    );
    if (spec.captions.keyword_quotes.length) {
      lines.push(`- Keep quotation marks on: ${spec.captions.keyword_quotes.map((word) => `"${word}"`).join(", ")}.`);
    }
  } else {
    lines.push("- Captions are off for this format.");
  }
  lines.push("", "== B-ROLL / INSERTS ==");
  if (plan.broll.length) {
    for (const slot of plan.broll) {
      const timing = slot.item !== null
        ? `item ${slot.item}: ${clock(slot.start)} - ${clock(slot.end)}`
        : `${clock(slot.start)}${slot.end !== null && slot.end !== undefined ? ` - ${clock(slot.end)}` : ""}`;
      const layout = slot.layout.style === "inset_card"
        ? `inset card, ${slot.layout.width_pct ?? 55}% wide, vertical center ${slot.layout.vertical_center_pct ?? 50}%`
        : slot.layout.style;
      lines.push(
        `- [${timing}] ${slot.role.replace(/_/g, " ")} (${slot.source.replace(/_/g, " ")}), ${layout}`,
        `    Audio: ${slot.audio_muted ? "MUTED" : "audible"}${slot.speed_multiplier && slot.speed_multiplier !== 1 ? `; speed ${slot.speed_multiplier}x` : ""}${slot.notes ? `; ${slot.notes}` : ""}`,
      );
    }
  } else {
    lines.push("- No b-roll slots detected.");
  }
  lines.push(
    "",
    "== AUDIO ==",
    `- Background music: ${spec.audio.background_music ? spec.audio.music_notes ?? "yes" : "NONE"}.`,
    `- Original voice: ${spec.audio.keep_original_voice ? "keep" : "remove"}.`,
  );
  if (spec.notes.length) {
    lines.push("", "== FORMAT NOTES ==");
    for (const note of spec.notes) lines.push(`- ${note}`);
  }
  if (plan.warnings.length) {
    lines.push("", "== NEEDS MANUAL ATTENTION ==");
    for (const warning of plan.warnings) lines.push(`- ${warning}`);
  }
  return `${lines.join("\n")}\n`;
}
