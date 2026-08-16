"use client";

import { useMemo, useState } from "react";
import type { CandidateCut, WordTimestamp } from "./lib/editing/engine.mjs";
import { getRemovedWordIndexes } from "./lib/editing/transcript-view.mjs";
import type { TranscriptCorrection } from "./lib/transcription/normalize.mjs";

const formatTime = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds - minutes * 60).toFixed(2).padStart(5, "0")}`;
};

export default function TranscriptParagraph({
  words,
  candidates,
  corrections,
  currentTime,
  onSeek,
  onCorrectionStatus,
}: {
  words: WordTimestamp[];
  candidates: CandidateCut[];
  corrections: TranscriptCorrection[];
  currentTime: number;
  onSeek: (time: number) => void;
  onCorrectionStatus: (wordIndex: number | "all", status: TranscriptCorrection["status"]) => void;
}) {
  const [view, setView] = useState<"source" | "edited">("source");
  const removedIndexes = useMemo(
    () => getRemovedWordIndexes(words, candidates),
    [candidates, words],
  );
  const visibleWords = useMemo(
    () => words
      .map((word, index) => ({ word, index }))
      .filter(({ index }) => view === "source" || !removedIndexes.has(index)),
    [removedIndexes, view, words],
  );
  const correctionsByIndex = useMemo(
    () => new Map(corrections.map((correction) => [correction.word_index, correction])),
    [corrections],
  );
  const appliedCorrections = corrections.filter((correction) => correction.status === "applied").length;

  return (
    <section className="transcript-paragraph-card" aria-labelledby="paragraph-transcript-title">
      <div className="transcript-paragraph-head">
        <div>
          <span className="eyebrow">Reading view</span>
          <h2 id="paragraph-transcript-title">Paragraph transcript</h2>
          <p>Read the complete thought flow and click any word to seek its source timestamp.</p>
        </div>
        <div className="paragraph-view-toggle" aria-label="Paragraph transcript view">
          <button className={view === "source" ? "active" : ""} onClick={() => setView("source")}>Source</button>
          <button className={view === "edited" ? "active" : ""} onClick={() => setView("edited")}>After cuts</button>
        </div>
      </div>

      <div className="paragraph-transcript-meta">
        <span><strong>{words.length}</strong> source words</span>
        <span><strong>{removedIndexes.size}</strong> removed by approved cuts</span>
        <span><strong>{Math.max(0, words.length - removedIndexes.size)}</strong> after edit</span>
      </div>

      {corrections.length ? (
        <div className="autocorrection-panel">
          <div className="autocorrection-summary">
            <span className="autocorrection-mark">Aa</span>
            <div>
              <strong>{appliedCorrections ? "Showing automatically corrected wording" : "Showing the original transcript"}</strong>
              <p>{corrections.length} context-supported wording suggestion{corrections.length === 1 ? "" : "s"} found; audio timestamps and original words remain available.</p>
            </div>
            <button onClick={() => onCorrectionStatus("all", appliedCorrections ? "reverted" : "applied")}>
              {appliedCorrections ? "Use original transcript" : "Show corrections"}
            </button>
          </div>
          <div className="autocorrection-changes" aria-label="Automatic transcript corrections">
            {corrections.map((correction) => (
              <div key={correction.word_index}>
                <span><s>{correction.original_text}</s> → <strong>{correction.corrected_text}</strong></span>
                <small>{Math.round(correction.confidence * 100)}% · {correction.reason}</small>
                <button onClick={() => onCorrectionStatus(
                  correction.word_index,
                  correction.status === "applied" ? "reverted" : "applied",
                )}>{correction.status === "applied" ? "Use original" : "Use correction"}</button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="autocorrection-clear"><span>✓</span><p><strong>Auto correction checked this transcript.</strong> No high-confidence replacements were found.</p></div>
      )}

      {visibleWords.length ? (
        <p className="paragraph-transcript-copy" aria-label={`${view === "source" ? "Source" : "Edited"} paragraph transcript`}>
          {visibleWords.map(({ word, index }) => {
            const removed = removedIndexes.has(index);
            const active = currentTime >= word.start && currentTime <= word.end;
            const lowConfidence = word.confidence !== undefined && word.confidence < 0.55;
            const correction = correctionsByIndex.get(index);
            const displayedWord = correction?.status === "applied" ? correction.corrected_text : word.word;
            return (
              <button
                key={`${word.start}-${word.end}-${index}`}
                className={`${removed ? "removed" : ""} ${active ? "active" : ""} ${lowConfidence ? "low-confidence" : ""} ${correction?.status === "applied" ? "auto-corrected" : ""}`}
                title={`${formatTime(word.start)}–${formatTime(word.end)}${word.confidence === undefined ? "" : ` · ${Math.round(word.confidence * 100)}% confidence`}${correction ? ` · original: ${word.word}` : ""}`}
                onClick={() => onSeek(word.start)}
              >{displayedWord}</button>
            );
          })}
        </p>
      ) : (
        <div className="paragraph-transcript-empty">Transcript words will appear after the video is analyzed.</div>
      )}

      <div className="paragraph-transcript-legend">
        <span><i className="paragraph-current" />Current word</span>
        {view === "source" && <span><i className="paragraph-removed" />Removed by approved cut</span>}
        <span><i className="paragraph-uncertain" />Below 55% confidence</span>
        <span><i className="paragraph-corrected" />Auto-corrected wording</span>
      </div>
    </section>
  );
}
