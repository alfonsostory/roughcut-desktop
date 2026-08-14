"use client";

import { useMemo, useState, type MouseEvent } from "react";
import type { CandidateCut, WordTimestamp } from "./lib/editing/engine.mjs";

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const formatTime = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds - minutes * 60).toFixed(2).padStart(5, "0")}`;
};

const reducePeaks = (peaks: number[], maximumBars = 180) => {
  if (peaks.length <= maximumBars) return peaks;
  const groupSize = peaks.length / maximumBars;
  return Array.from({ length: maximumBars }, (_, index) => {
    const start = Math.floor(index * groupSize);
    const end = Math.max(start + 1, Math.ceil((index + 1) * groupSize));
    return Math.max(...peaks.slice(start, end));
  });
};

export default function TranscriptWaveform({
  words,
  cuts,
  peaks,
  duration,
  currentTime,
  onSeek,
}: {
  words: WordTimestamp[];
  cuts: CandidateCut[];
  peaks: number[];
  duration: number;
  currentTime: number;
  onSeek: (time: number) => void;
}) {
  const [requestedWindow, setRequestedWindow] = useState(12);
  const maximumWindow = Math.max(4, Math.min(60, duration || 60));
  const windowDuration = Math.min(duration || requestedWindow, requestedWindow);
  const windowStart = clamp(currentTime - windowDuration / 2, 0, Math.max(0, duration - windowDuration));
  const windowEnd = Math.min(duration, windowStart + windowDuration);
  const timelineSpan = Math.max(0.001, windowEnd - windowStart);

  const visibleWords = useMemo(
    () => words.filter((word) => word.end >= windowStart && word.start <= windowEnd),
    [words, windowEnd, windowStart],
  );
  const visibleCuts = useMemo(
    () => cuts.filter((cut) => cut.end >= windowStart && cut.start <= windowEnd),
    [cuts, windowEnd, windowStart],
  );
  const visiblePeaks = useMemo(() => {
    if (!peaks.length || duration <= 0) return [];
    const startIndex = Math.floor((windowStart / duration) * peaks.length);
    const endIndex = Math.max(startIndex + 1, Math.ceil((windowEnd / duration) * peaks.length));
    return reducePeaks(peaks.slice(startIndex, endIndex));
  }, [duration, peaks, windowEnd, windowStart]);

  const seekFromTrack = (event: MouseEvent<HTMLButtonElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = clamp((event.clientX - bounds.left) / bounds.width, 0, 1);
    onSeek(windowStart + ratio * timelineSpan);
  };
  const position = (time: number) => `${clamp(((time - windowStart) / timelineSpan) * 100, 0, 100)}%`;
  const width = (start: number, end: number) => `${Math.max(0.35, ((Math.min(end, windowEnd) - Math.max(start, windowStart)) / timelineSpan) * 100)}%`;
  const playheadPosition = position(currentTime);

  return (
    <section className="transcript-waveform-card" aria-labelledby="transcript-waveform-title">
      <div className="transcript-waveform-head">
        <div>
          <span className="eyebrow">Timestamp inspector</span>
          <h2 id="transcript-waveform-title">Word transcript + audio waveform</h2>
          <p>Click a word or the waveform to seek the source video.</p>
        </div>
        <div className="waveform-inspector-controls">
          <button aria-label="Move waveform window backward" onClick={() => onSeek(Math.max(0, currentTime - windowDuration * 0.8))}>−</button>
          <label>
            Window <strong>{Math.round(windowDuration)}s</strong>
            <input
              type="range"
              min="4"
              max={maximumWindow}
              step="1"
              value={Math.min(requestedWindow, maximumWindow)}
              onChange={(event) => setRequestedWindow(Number(event.target.value))}
            />
          </label>
          <button aria-label="Move waveform window forward" onClick={() => onSeek(Math.min(duration, currentTime + windowDuration * 0.8))}>＋</button>
        </div>
      </div>

      <div className="waveform-inspector-ruler" aria-hidden>
        {Array.from({ length: 5 }, (_, index) => (
          <span key={index}>{formatTime(windowStart + (timelineSpan * index) / 4)}</span>
        ))}
      </div>

      <div className="word-timestamp-track" aria-label="Words aligned to source timestamps">
        {visibleWords.map((word, index) => {
          const active = currentTime >= word.start && currentTime <= word.end;
          const lowConfidence = word.confidence !== undefined && word.confidence < 0.55;
          return (
            <button
              key={`${word.start}-${word.end}-${index}`}
              className={`${active ? "active" : ""} ${lowConfidence ? "low-confidence" : ""}`}
              style={{ left: position(word.start), width: width(word.start, word.end) }}
              title={`${word.word} · ${formatTime(word.start)}–${formatTime(word.end)}${word.confidence === undefined ? "" : ` · ${Math.round(word.confidence * 100)}%`}`}
              onClick={() => onSeek(word.start)}
            >
              <span>{word.word}</span>
              <i>{formatTime(word.start)}</i>
            </button>
          );
        })}
        <i className="inspector-playhead" style={{ left: playheadPosition }} />
      </div>

      <button className="audio-peak-track" onClick={seekFromTrack} aria-label="Seek using audio waveform">
        {visiblePeaks.length ? visiblePeaks.map((peak, index) => (
          <i key={index} style={{ height: `${Math.max(3, peak * 100)}%` }} />
        )) : <span>Waveform peaks will appear after the video is transcribed.</span>}
        {visibleCuts.map((cut) => (
          <b
            key={cut.id}
            className={`${cut.status === "rejected" ? "kept" : "approved"} ${cut.validation.valid ? "" : "blocked"}`}
            style={{ left: position(cut.start), width: width(cut.start, cut.end) }}
            title={`${cut.type} cut · ${formatTime(cut.start)}–${formatTime(cut.end)}`}
          />
        ))}
        <i className="inspector-playhead" style={{ left: playheadPosition }} />
      </button>

      <div className="waveform-inspector-legend">
        <span><i className="legend-audio" />Audio energy</span>
        <span><i className="legend-word" />Timed word</span>
        <span><i className="legend-cut" />Approved cut</span>
        <strong>{formatTime(currentTime)}</strong>
      </div>
    </section>
  );
}
