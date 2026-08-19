import { lexicalTokens, normalizeToken, tokenSimilarity } from "../transcription/script-assistance.mjs";

export const OVERLAY_PLAN_VERSION = "roughcut-overlay-plan/0.1";

const seconds = (value) => Number(value.toFixed(3));
const TOKEN_MATCH_THRESHOLD = 0.66;
const endsSentence = (value) => /[.!?…]["')\]]*$/u.test(String(value ?? ""));

export function buildTimelineWords(words, keepRanges) {
  const sorted = [...keepRanges].sort((left, right) => left.start - right.start);
  const timelineWords = [];
  let cursor = 0;
  for (const range of sorted) {
    const offset = cursor - range.start;
    words.forEach((word, index) => {
      const midpoint = (word.start + word.end) / 2;
      if (midpoint < range.start || midpoint >= range.end) return;
      timelineWords.push({
        index,
        word: word.word,
        source_start: seconds(word.start),
        source_end: seconds(word.end),
        start: seconds(Math.max(range.start, word.start) + offset),
        end: seconds(Math.min(range.end, word.end) + offset),
      });
    });
    cursor += range.end - range.start;
  }
  return timelineWords.sort((left, right) => left.start - right.start);
}

export function timelineDuration(keepRanges) {
  return seconds(keepRanges.reduce((total, range) => total + (range.end - range.start), 0));
}

export function chunkCaptionCues(timelineWords, { maxWords = 4, maxGapSeconds = 0.6 } = {}) {
  const cues = [];
  let current = null;
  for (const word of timelineWords) {
    const previous = current?.words.at(-1);
    const breakBefore = !current
      || current.words.length >= maxWords
      || (previous && word.start - previous.end > maxGapSeconds)
      || (previous && endsSentence(previous.word));
    if (breakBefore) {
      current = { words: [word] };
      cues.push(current);
      continue;
    }
    current.words.push(word);
  }
  return cues.map((cue) => ({
    start: cue.words[0].start,
    end: cue.words.at(-1).end,
    text: cue.words.map((word) => String(word.word).trim()).filter(Boolean).join(" "),
  }));
}

export function styleCaptionText(text, { textCase = "original", keywordQuotes = [], punctuation = "keep" } = {}) {
  let styled = String(text ?? "").trim();
  if (punctuation === "strip_terminal") styled = styled.replace(/[.,!?…]+$/u, "");
  if (textCase === "lowercase") styled = styled.toLocaleLowerCase();
  if (textCase === "uppercase") styled = styled.toLocaleUpperCase();
  if (textCase === "sentence") styled = styled.charAt(0).toLocaleUpperCase() + styled.slice(1).toLocaleLowerCase();
  for (const keyword of keywordQuotes) {
    const target = normalizeToken(keyword);
    if (!target) continue;
    styled = styled
      .split(" ")
      .map((token) => {
        const core = token.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/u)?.[0];
        if (!core || normalizeToken(core) !== target) return token;
        if (token.includes(`"`)) return token;
        return token.replace(core, `"${core}"`);
      })
      .join(" ");
  }
  return styled;
}

const contentTokens = (text) => lexicalTokens(text)
  .map(normalizeToken)
  .filter((token) => token.length >= 2 && !/^\d+$/.test(token));

const matchTokensFrom = (timelineWords, startIndex, targets) => {
  const windowEnd = Math.min(timelineWords.length, startIndex + targets.length + 6);
  let targetIndex = 0;
  let matched = 0;
  let lastMatched = startIndex;
  for (let index = startIndex; index < windowEnd && targetIndex < targets.length; index += 1) {
    const token = normalizeToken(timelineWords[index].word);
    let bestOffset = -1;
    let bestSimilarity = 0;
    for (let offset = 0; offset < Math.min(2, targets.length - targetIndex); offset += 1) {
      const similarity = tokenSimilarity(token, targets[targetIndex + offset]);
      if (similarity >= TOKEN_MATCH_THRESHOLD && similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestOffset = offset;
      }
    }
    if (bestOffset < 0) continue;
    targetIndex += bestOffset + 1;
    matched += 1;
    lastMatched = index;
  }
  return { matched, coverage: targets.length ? matched / targets.length : 0, endIndex: lastMatched };
};

export function locateListItemSpans(timelineWords, itemTitles, { minCoverage = 0.5 } = {}) {
  const spans = [];
  let cursor = 0;
  itemTitles.forEach((title, itemIndex) => {
    const targets = contentTokens(title);
    const ordinal = String(itemIndex + 1);
    let best = null;
    for (let index = cursor; index < timelineWords.length; index += 1) {
      const result = matchTokensFrom(timelineWords, index, targets);
      if (!targets.length || result.coverage < minCoverage) continue;
      const nearOrdinal = timelineWords
        .slice(Math.max(cursor, index - 4), index + 1)
        .some((word) => normalizeToken(word.word) === ordinal);
      const score = result.coverage + (nearOrdinal ? 0.25 : 0);
      if (!best || score > best.score + 0.05) {
        best = { score, startIndex: index, endIndex: result.endIndex };
        if (nearOrdinal && result.coverage >= 0.75) break;
      }
    }
    if (best) {
      spans.push({
        item: itemIndex + 1,
        title,
        found: true,
        word_start: best.startIndex,
        word_end: best.endIndex,
        start: timelineWords[best.startIndex].start,
        end: timelineWords[best.endIndex].end,
      });
      cursor = best.endIndex + 1;
    } else {
      spans.push({ item: itemIndex + 1, title, found: false, word_start: null, word_end: null, start: null, end: null });
    }
  });
  return spans;
}

const numberedTitle = (numbering, itemNumber, title) => {
  if (!numbering?.enabled) return title;
  const pattern = numbering.format && numbering.format.includes("1") ? numbering.format : "1. ";
  return `${pattern.replace("1", String(itemNumber))}${title}`;
};

const locateSectionStart = (timelineWords, contentHint, fromTime) => {
  const targets = contentTokens(contentHint ?? "");
  if (!targets.length) return null;
  for (let index = 0; index < timelineWords.length; index += 1) {
    if (timelineWords[index].start < fromTime) continue;
    const result = matchTokensFrom(timelineWords, index, targets);
    if (result.coverage >= 0.5) return timelineWords[index].start;
  }
  return null;
};

export function planFormatOverlays({ spec, words, keepRanges }) {
  const timelineWords = buildTimelineWords(words, keepRanges);
  const duration = timelineDuration(keepRanges);
  const warnings = [];
  const listItems = spec.structure.list_items;
  const spans = listItems.length ? locateListItemSpans(timelineWords, listItems) : [];

  const itemWindows = spans.map((span, index) => {
    const nextFound = spans.slice(index + 1).find((candidate) => candidate.found);
    return {
      ...span,
      window_start: span.found ? span.start : null,
      window_end: span.found ? (nextFound?.start ?? duration) : null,
    };
  });
  for (const span of itemWindows) {
    if (!span.found) {
      warnings.push(`List item ${span.item} ("${span.title}") was not found in the spoken words; place its title and image manually.`);
    }
  }

  const firstItemStart = itemWindows.find((span) => span.found)?.start ?? Math.min(3, duration);
  const titles = [];
  for (const overlay of spec.text_overlays) {
    if (overlay.role === "item_title" && overlay.content_source === "brief_list") {
      for (const span of itemWindows) {
        titles.push({
          role: "item_title",
          item: span.item,
          text: numberedTitle(overlay.numbering, span.item, span.title),
          start: span.window_start,
          end: span.found && overlay.timing.hold_seconds !== null
            ? seconds(Math.min(span.window_start + overlay.timing.hold_seconds, duration))
            : span.window_end,
          placement: overlay.placement,
          box: overlay.box,
          font: overlay.font,
          lines_max: overlay.lines_max,
        });
      }
      continue;
    }
    const text = overlay.content_source === "brief_hook"
      ? spec.structure.hook_text
      : overlay.fixed_text;
    if (!text) {
      if (overlay.role !== "item_title") {
        warnings.push(`The ${overlay.role} overlay has no text; fill it in manually.`);
      }
      continue;
    }
    const entireVideo = overlay.timing.strategy === "entire_video";
    titles.push({
      role: overlay.role,
      item: null,
      text,
      start: 0,
      end: entireVideo ? duration : seconds(Math.min(overlay.timing.hold_seconds ?? firstItemStart, duration)),
      placement: overlay.placement,
      box: overlay.box,
      font: overlay.font,
      lines_max: overlay.lines_max,
    });
  }

  const captionStyle = {
    textCase: spec.captions.font.case,
    keywordQuotes: spec.captions.keyword_quotes,
    punctuation: spec.captions.punctuation,
  };
  const captions = spec.captions.enabled
    ? chunkCaptionCues(timelineWords, { maxWords: spec.captions.words_per_cue_max }).map((cue) => ({
      ...cue,
      text: styleCaptionText(cue.text, captionStyle),
    }))
    : [];

  const broll = [];
  for (const slot of spec.broll) {
    if (slot.timing.strategy === "per_list_item") {
      for (const span of itemWindows) {
        broll.push({
          ...slot,
          item: span.item,
          start: span.window_start,
          end: span.window_end,
        });
      }
      continue;
    }
    const sectionStart = slot.timing.strategy === "section"
      ? locateSectionStart(
        timelineWords,
        spec.structure.sections.find((section) => section.label === slot.timing.section_label)?.content_hint,
        0,
      )
      : null;
    if (slot.timing.strategy === "section" && sectionStart === null) {
      warnings.push(`The ${slot.role} section ("${slot.timing.section_label ?? "unnamed"}") was not found in the spoken words; place it manually.`);
    }
    broll.push({ ...slot, item: null, start: sectionStart, end: null });
  }

  return {
    version: OVERLAY_PLAN_VERSION,
    duration,
    titles,
    captions,
    broll,
    audio: spec.audio,
    warnings,
  };
}
