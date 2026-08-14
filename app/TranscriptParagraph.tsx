"use client";

import { useMemo, useState } from "react";
import type { CandidateCut, WordTimestamp } from "./lib/editing/engine.mjs";
import { getRemovedWordIndexes } from "./lib/editing/transcript-view.mjs";

const formatTime = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds - minutes * 60).toFixed(2).padStart(5, "0")}`;
};

export default function TranscriptParagraph({
  words,
  candidates,
  currentTime,
  onSeek,
}: {
  words: WordTimestamp[];
  candidates: CandidateCut[];
  currentTime: number;
  onSeek: (time: number) => void;
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

      {visibleWords.length ? (
        <p className="paragraph-transcript-copy" aria-label={`${view === "source" ? "Source" : "Edited"} paragraph transcript`}>
          {visibleWords.map(({ word, index }) => {
            const removed = removedIndexes.has(index);
            const active = currentTime >= word.start && currentTime <= word.end;
            const lowConfidence = word.confidence !== undefined && word.confidence < 0.55;
            return (
              <button
                key={`${word.start}-${word.end}-${index}`}
                className={`${removed ? "removed" : ""} ${active ? "active" : ""} ${lowConfidence ? "low-confidence" : ""}`}
                title={`${formatTime(word.start)}–${formatTime(word.end)}${word.confidence === undefined ? "" : ` · ${Math.round(word.confidence * 100)}% confidence`}`}
                onClick={() => onSeek(word.start)}
              >{word.word}</button>
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
      </div>
    </section>
  );
}
