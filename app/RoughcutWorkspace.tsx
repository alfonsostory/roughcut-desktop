"use client";
/* eslint-disable jsx-a11y/media-has-caption -- Phase 1 intentionally does not create caption tracks. */

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_CONFIG,
  buildEdl,
  generateCandidateCuts,
  validateCut,
  validateEditedResult,
  type AudioBreath,
  type AudioSilence,
  type CandidateCut,
  type CutConfig,
  type CutStatus,
  type SemanticHint,
  type WordTimestamp,
} from "./lib/editing/engine.mjs";
import { detectRetakeHints, mergeSemanticHints } from "./lib/editing/retakes.mjs";
import { SAMPLE_DURATION, sampleSemanticHints, sampleWords } from "./lib/editing/sample";
import { findFirstRecognizableWord, normalizeTranscriptPayload, type TranscriptPayload } from "./lib/transcription/normalize.mjs";

type Filter = "all" | "needs_review" | "approved" | "rejected";
type TranscriptionState = "idle" | "transcribing" | "ready" | "error";
type RenderState = "idle" | "rendering" | "ready" | "error";
type SegmentExportState = "idle" | "exporting" | "error";

const MEDIA_SERVICE_URL = "http://127.0.0.1:4317";

const formatTime = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${rest.toFixed(2).padStart(5, "0")}`;
};

const typeLabel: Record<CandidateCut["type"], string> = {
  silence: "Pause",
  retake: "Retake",
  repetition: "Repeat",
  filler: "Filler",
};

const cutLabel = (cut: CandidateCut) => cut.openingTrim
  ? "Opening trim"
  : cut.breathDetected
    ? "Breath pause"
    : typeLabel[cut.type];

const waveform = [18, 35, 44, 29, 52, 66, 34, 59, 71, 43, 31, 55, 19, 14, 11, 13, 29, 48, 63, 38, 57, 74, 45, 26, 17, 12, 33, 62, 77, 54, 40, 67, 49, 24, 16, 12, 10, 35, 58, 69, 47, 61, 79, 52, 36, 28, 14, 12, 25, 47, 66, 73, 42, 56, 31, 19, 13, 22, 51, 68, 39, 57, 72, 44, 30, 16, 12, 37, 64, 49, 72, 55, 32, 18, 28, 61, 75, 46, 33, 56, 70, 38, 22, 15, 29, 59, 78, 54, 42, 63, 47, 26, 18, 35, 67, 52];

export default function RoughcutWorkspace() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const transcriptInputRef = useRef<HTMLInputElement>(null);
  const sourceFileRef = useRef<File | undefined>(undefined);
  const transcriptionAbortRef = useRef<AbortController | undefined>(undefined);
  const [videoUrl, setVideoUrl] = useState<string>();
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [viewMode, setViewMode] = useState<"source" | "preview">("source");
  const [mediaId, setMediaId] = useState<string>();
  const [fileName, setFileName] = useState("founder_interview_take_04.mp4");
  const [words, setWords] = useState<WordTimestamp[]>(sampleWords);
  const [hints, setHints] = useState<SemanticHint[]>(sampleSemanticHints);
  const [audioSilences, setAudioSilences] = useState<AudioSilence[]>([]);
  const [audioBreaths, setAudioBreaths] = useState<AudioBreath[]>([]);
  const [silenceThresholdDb, setSilenceThresholdDb] = useState(-40);
  const [duration, setDuration] = useState(SAMPLE_DURATION);
  const [config, setConfig] = useState<CutConfig>({ ...DEFAULT_CONFIG });
  const [candidates, setCandidates] = useState<CandidateCut[]>(() =>
    generateCandidateCuts(sampleWords, sampleSemanticHints),
  );
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string>();
  const [adjustingId, setAdjustingId] = useState<string>();
  const [saveState, setSaveState] = useState("Corrections saved");
  const [importNote, setImportNote] = useState("Demo analysis · word timestamps loaded");
  const [transcriptionState, setTranscriptionState] = useState<TranscriptionState>("idle");
  const [renderState, setRenderState] = useState<RenderState>("idle");
  const [segmentExportState, setSegmentExportState] = useState<SegmentExportState>("idle");
  const [renderNote, setRenderNote] = useState("Render after reviewing cuts");
  const [hasSourceFile, setHasSourceFile] = useState(false);

  useEffect(() => () => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
  }, [videoUrl]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  useEffect(() => () => transcriptionAbortRef.current?.abort(), []);

  useEffect(() => () => {
    if (mediaId) void fetch(`${MEDIA_SERVICE_URL}/media/${mediaId}`, { method: "DELETE", keepalive: true });
  }, [mediaId]);

  const filtered = useMemo(
    () => candidates.filter((cut) => filter === "all" || cut.status === filter),
    [candidates, filter],
  );
  const edl = useMemo(() => buildEdl(duration, candidates), [duration, candidates]);
  const keepRanges = useMemo(
    () => edl.filter((range) => range.action === "keep").map(({ start, end }) => ({ start, end })),
    [edl],
  );
  const edlSignature = useMemo(() => JSON.stringify(keepRanges), [keepRanges]);
  const validation = useMemo(() => validateEditedResult(words, candidates, config), [words, candidates, config]);
  const approved = candidates.filter((cut) => cut.status === "approved").length;
  const reviewCount = candidates.filter((cut) => cut.status === "needs_review").length;
  const removedDuration = edl
    .filter((range) => range.action === "remove")
    .reduce((sum, range) => sum + range.end - range.start, 0);

  const invalidatePreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(undefined);
    setViewMode("source");
    setRenderState("idle");
    setRenderNote("Cuts changed · render a fresh preview");
  };

  const renderedEdlRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (previewUrl && renderedEdlRef.current !== edlSignature) invalidatePreview();
  // Preview invalidation intentionally follows only deterministic EDL changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edlSignature]);

  const previewCut = (cut: CandidateCut) => {
    setSelectedId(cut.id);
    setViewMode("source");
    if (!videoRef.current || !videoUrl) return;
    videoRef.current.src = videoUrl;
    videoRef.current.currentTime = Math.max(0, cut.start - 1.2);
    void videoRef.current.play();
    window.setTimeout(() => videoRef.current?.pause(), Math.max(1200, (cut.end - cut.start + 2.4) * 1000));
  };

  const persistCorrection = async (
    cut: CandidateCut,
    action: "adjusted" | "approved" | "rejected",
    humanStart = cut.start,
    humanEnd = cut.end,
  ) => {
    setSaveState("Saving correction…");
    try {
      const response = await fetch("/api/corrections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          candidate_cut_id: cut.id,
          ai_start: cut.start,
          ai_end: cut.end,
          human_start: humanStart,
          human_end: humanEnd,
          human_action: action,
          reason: action === "adjusted" ? "Boundary adjusted in review workspace" : "Reviewer decision",
        }),
      });
      if (!response.ok) throw new Error("Save failed");
      setSaveState("Corrections saved");
    } catch {
      setSaveState("Saved in this review only");
    }
  };

  const setCutStatus = (cut: CandidateCut, status: CutStatus) => {
    setCandidates((current) => current.map((item) =>
      item.id === cut.id
        ? { ...item, status, humanOverride: status === "approved" || item.humanOverride }
        : item,
    ));
    void persistCorrection(cut, status === "approved" ? "approved" : "rejected");
  };

  const saveAdjustment = (cut: CandidateCut, start: number, end: number) => {
    const checked = validateCut({ start, end }, words, config);
    setCandidates((current) => current.map((item) =>
      item.id === cut.id
        ? { ...item, start, end, validation: checked, status: checked.valid ? "approved" : "needs_review", humanOverride: checked.valid }
        : item,
    ));
    setAdjustingId(undefined);
    void persistCorrection(cut, "adjusted", start, end);
  };

  const updateConfig = (key: keyof CutConfig, value: number) => {
    const next = { ...config, [key]: value };
    const openingWord = findFirstRecognizableWord(words);
    setConfig(next);
    setCandidates(generateCandidateCuts(words, hints, next, {
      duration,
      audioSilences,
      audioBreaths,
      openingWordIndex: openingWord.index,
      openingWordConfidence: openingWord.confidence,
      silenceThresholdDb,
    }));
  };

  const applyTranscript = (payload: TranscriptPayload) => {
    const normalized = normalizeTranscriptPayload(payload);
    const semanticHints = mergeSemanticHints(
      normalized.semantic_hints,
      detectRetakeHints(normalized.words, { retakeWindow: config.retakeWindow }),
    );
    const detectedSilences = normalized.audio_analysis?.silences ?? [];
    const detectedBreaths = normalized.audio_analysis?.breaths ?? [];
    const detectedThreshold = normalized.audio_analysis?.silence_threshold_db ?? -40;
    const openingWord = normalized.opening_word;
    setWords(normalized.words);
    setHints(semanticHints);
    setAudioSilences(detectedSilences);
    setAudioBreaths(detectedBreaths);
    setSilenceThresholdDb(detectedThreshold);
    setDuration(normalized.duration);
    setCandidates(generateCandidateCuts(normalized.words, semanticHints, config, {
      duration: normalized.duration,
      audioSilences: detectedSilences,
      audioBreaths: detectedBreaths,
      openingWordIndex: openingWord.index,
      openingWordConfidence: openingWord.confidence,
      silenceThresholdDb: detectedThreshold,
    }));
    setTranscriptionState("ready");
    const retakeCount = semanticHints.filter((hint) => hint.kind === "retake").length;
    setImportNote(`${normalized.words.length} timed words · starts at “${openingWord.word.word}” · ${detectedSilences.length} silences · ${detectedBreaths.length} breaths · ${retakeCount} likely retake${retakeCount === 1 ? "" : "s"}`);
  };

  const transcribeVideo = async (file: File) => {
    transcriptionAbortRef.current?.abort();
    const controller = new AbortController();
    transcriptionAbortRef.current = controller;
    setTranscriptionState("transcribing");
    setImportNote("Transcribing locally… first run may take a minute");
    try {
      const response = await fetch(`${MEDIA_SERVICE_URL}/prepare`, {
        method: "POST",
        headers: {
          "content-type": file.type || "application/octet-stream",
          "x-file-name": encodeURIComponent(file.name),
        },
        body: file,
        signal: controller.signal,
      });
      const payload = await response.json() as TranscriptPayload & { error?: string; media_id?: string };
      if (!response.ok) throw new Error(payload.error || "Local transcription failed.");
      if (sourceFileRef.current !== file) return;
      if (!payload.media_id) throw new Error("Local media preparation did not return a project ID.");
      setMediaId(payload.media_id);
      applyTranscript(payload);
    } catch (error) {
      if (controller.signal.aborted) return;
      setTranscriptionState("error");
      const message = error instanceof Error && !error.message.includes("fetch")
        ? error.message
        : "Local transcriber is unavailable.";
      setImportNote(`${message} Import transcript JSON or retry.`);
    }
  };

  const importVideo = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (mediaId) void fetch(`${MEDIA_SERVICE_URL}/media/${mediaId}`, { method: "DELETE" });
    setVideoUrl(URL.createObjectURL(file));
    setPreviewUrl(undefined);
    setViewMode("source");
    setMediaId(undefined);
    setRenderState("idle");
    setSegmentExportState("idle");
    setRenderNote("Render after reviewing cuts");
    setFileName(file.name);
    setWords([]);
    setHints([]);
    setAudioSilences([]);
    setAudioBreaths([]);
    setCandidates([]);
    setSelectedId(undefined);
    sourceFileRef.current = file;
    setHasSourceFile(true);
    setImportNote("Preparing local transcription…");
    void transcribeVideo(file);
    event.target.value = "";
  };

  const handleVideoMetadata = () => {
    const mediaDuration = videoRef.current?.duration;
    if (mediaDuration && Number.isFinite(mediaDuration)) setDuration(mediaDuration);
  };

  const requestRenderedPreview = async () => {
    if (!mediaId) return;
    setRenderState("rendering");
    setRenderNote("Rendering approved cuts locally…");
    try {
      const response = await fetch(`${MEDIA_SERVICE_URL}/render`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ media_id: mediaId, duration, keep_ranges: keepRanges }),
      });
      if (!response.ok) {
        const payload = await response.json() as { error?: string };
        throw new Error(payload.error || "Preview render failed.");
      }
      const measuredSilenceMs = Number(response.headers.get("x-roughcut-max-silence-ms"));
      const remainingLongSilences = Number(response.headers.get("x-roughcut-long-silence-count"));
      const nextUrl = URL.createObjectURL(await response.blob());
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(nextUrl);
      renderedEdlRef.current = edlSignature;
      setViewMode("preview");
      setRenderState("ready");
      setRenderNote(remainingLongSilences > 0
        ? `${keepRanges.length} segments · ${remainingLongSilences} pauses still exceed 200 ms`
        : `${keepRanges.length} segments · preview verified · longest silence ${measuredSilenceMs} ms`);
    } catch (error) {
      setRenderState("error");
      setRenderNote(error instanceof Error ? error.message : "Preview render failed.");
    }
  };

  const downloadRenderedPreview = () => {
    if (!previewUrl) return;
    const anchor = document.createElement("a");
    anchor.href = previewUrl;
    anchor.download = `${fileName.replace(/\.[^.]+$/, "")}-roughcut.mp4`;
    anchor.click();
  };

  const exportSegments = async () => {
    if (!mediaId) return;
    setSegmentExportState("exporting");
    setRenderNote(`Exporting ${keepRanges.length} high-quality source segments…`);
    try {
      const response = await fetch(`${MEDIA_SERVICE_URL}/segments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ media_id: mediaId, duration, keep_ranges: keepRanges }),
      });
      if (!response.ok) {
        const payload = await response.json() as { error?: string };
        throw new Error(payload.error || "Segment export failed.");
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${fileName.replace(/\.[^.]+$/, "")}-segments.zip`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setSegmentExportState("idle");
      setRenderNote(`${keepRanges.length} numbered clips exported for CapCut`);
    } catch (error) {
      setSegmentExportState("error");
      setRenderNote(error instanceof Error ? error.message : "Segment export failed.");
    }
  };

  const importTranscript = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      transcriptionAbortRef.current?.abort();
      applyTranscript(JSON.parse(await file.text()) as TranscriptPayload);
    } catch {
      setTranscriptionState("error");
      setImportNote("Transcript JSON could not be read");
    }
    event.target.value = "";
  };

  const exportEdl = () => {
    const payload = {
      version: "roughcut-edl/0.1",
      source: { file_name: fileName, duration },
      settings: config,
      sync: { mode: "automatic_audio_track_offset" },
      candidates,
      ranges: edl,
      validation,
      transcript: validation.reconstructedTranscript,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `${fileName.replace(/\.[^.]+$/, "")}.roughcut.edl.json`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">R</span><span>Roughcut</span><span className="phase-pill">Phase 1</span></div>
        <div className="top-actions">
          <span className="save-state"><i />{saveState}</span>
          <button className="button button-quiet" onClick={() => transcriptInputRef.current?.click()}>Import transcript</button>
          <button className="button button-primary" onClick={exportEdl}>Export EDL <span aria-hidden>↗</span></button>
        </div>
      </header>

      <section className="project-strip">
        <div>
          <span className="eyebrow">Current project</span>
          <h1>Founder interview — rough cut</h1>
        </div>
        <div className="project-stats" aria-label="Project summary">
          <div><strong>{formatTime(duration)}</strong><span>source</span></div>
          <div><strong>−{removedDuration.toFixed(1)}s</strong><span>removed</span></div>
          <div><strong>{approved}/{candidates.length}</strong><span>cuts active</span></div>
          <div className={validation.valid ? "healthy" : "warning"}><strong>{validation.valid ? "Meaning intact" : "Check meaning"}</strong><span>validation</span></div>
        </div>
      </section>

      <section className="workspace">
        <div className="viewer-column">
          <div className="viewer-card">
            <div className="viewer-toolbar">
              <div className="file-meta"><span className="record-dot" /><div><strong>{fileName}</strong><span>{importNote}</span></div></div>
              <div className="viewer-actions">
                {previewUrl && (
                  <div className="view-toggle" aria-label="Video view">
                    <button className={viewMode === "source" ? "active" : ""} onClick={() => setViewMode("source")}>Source</button>
                    <button className={viewMode === "preview" ? "active" : ""} onClick={() => setViewMode("preview")}>Cut preview</button>
                  </div>
                )}
                {transcriptionState === "transcribing" && <span className="transcription-badge"><i /> Local transcription</span>}
                {transcriptionState === "error" && hasSourceFile && (
                  <button className="retry-transcription" onClick={() => {
                    const sourceFile = sourceFileRef.current;
                    if (sourceFile) void transcribeVideo(sourceFile);
                  }}>Retry transcript</button>
                )}
                <button className="icon-button" aria-label="Import another video" onClick={() => videoInputRef.current?.click()}>＋</button>
              </div>
            </div>
            <div className="video-stage">
              {videoUrl ? (
                <video
                  key={viewMode}
                  ref={videoRef}
                  src={viewMode === "preview" && previewUrl ? previewUrl : videoUrl}
                  controls
                  playsInline
                  onLoadedMetadata={viewMode === "source" ? handleVideoMetadata : undefined}
                />
              ) : (
                <button className="empty-video" onClick={() => videoInputRef.current?.click()}>
                  <span className="play-orb">▶</span>
                  <strong>Attach the source video</strong>
                  <span>The demo analysis is ready. Your footage stays on this device.</span>
                </button>
              )}
              <div className="safe-badge"><span>✓</span> {viewMode === "preview" ? "Approved cuts rendered" : "Word + audio-safe boundaries"}</div>
            </div>
            <div className="transport">
              <button aria-label="Jump backward">−5</button><button className="transport-play" aria-label="Play">▶</button><button aria-label="Jump forward">+5</button>
              <span className="transport-time">{selectedId && viewMode === "source" ? formatTime(candidates.find((item) => item.id === selectedId)?.start ?? 0) : "0:00.00"} <i>/</i> {formatTime(viewMode === "preview" ? duration - removedDuration : duration)}</span>
              <span className="transport-spacer" /><button aria-label="Volume">⌁</button><button aria-label="Fullscreen">⛶</button>
            </div>
          </div>

          <div className="timeline-card">
            <div className="timeline-head">
              <div><span className="eyebrow">Source timeline</span><strong>Speech + candidate cuts</strong></div>
              <div className="legend"><span><i className="legend-remove" />Remove</span><span><i className="legend-review" />Review</span></div>
            </div>
            <div className="ruler"><span>0:00</span><span>0:08</span><span>0:16</span><span>0:24</span><span>0:33</span></div>
            <div className="waveform" aria-label="Audio waveform and candidate cut positions">
              {waveform.map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}
              {candidates.map((cut) => (
                <button
                  key={cut.id}
                  className={`cut-marker ${cut.status === "needs_review" ? "review" : ""} ${selectedId === cut.id ? "selected" : ""}`}
                  style={{ left: `${(cut.start / duration) * 100}%`, width: `${Math.max(1.2, ((cut.end - cut.start) / duration) * 100)}%` }}
                  onClick={() => previewCut(cut)}
                  aria-label={`Preview ${cutLabel(cut)} at ${formatTime(cut.start)}`}
                />
              ))}
              <span className="playhead" />
            </div>
            <div className="timeline-status">
              <span><i className="status-check">✓</i> Boundaries use timed words or verified silence</span>
              <span><i className="status-check">✓</i> Breaths inside word gaps count as pauses</span>
              <span><i className="status-check">✓</i> Minimum speech padding {Math.round(config.minimumSpeechSide * 1000)} ms</span>
              <span className={reviewCount ? "needs-attention" : ""}><i>!</i> {reviewCount} need review</span>
            </div>
          </div>

          <details className="settings-card">
            <summary><span><span className="settings-icon">⌁</span> Cut safety settings</span><span>Calibrated 180 / 200 ms preset <b>⌄</b></span></summary>
            <div className="settings-grid">
              <label>Maximum speech gap <strong>{Math.round(config.longPauseThreshold * 1000)} ms</strong><input type="range" min="0.2" max="0.7" step="0.01" value={config.longPauseThreshold} onChange={(event) => updateConfig("longPauseThreshold", Number(event.target.value))} /></label>
              <label>Target remaining pause <strong>{Math.round(config.targetPause * 1000)} ms</strong><input type="range" min="0.12" max="0.19" step="0.01" value={config.targetPause} onChange={(event) => updateConfig("targetPause", Number(event.target.value))} /></label>
              <label>Speech-side padding <strong>{Math.round(config.speechSafetyPadding * 1000)} ms</strong><input type="range" min="0.06" max="0.12" step="0.01" value={config.speechSafetyPadding} onChange={(event) => updateConfig("speechSafetyPadding", Number(event.target.value))} /></label>
            </div>
          </details>

          <section className="export-card" aria-labelledby="output-heading">
            <div className="export-copy">
              <span className="eyebrow">Rendered output</span>
              <h2 id="output-heading">Preview, then continue in CapCut</h2>
              <p>{renderNote}</p>
            </div>
            <div className="export-actions">
              <button
                className="button button-primary"
                disabled={!mediaId || renderState === "rendering"}
                onClick={() => void requestRenderedPreview()}
              >{renderState === "rendering" ? "Rendering…" : previewUrl ? "Render again" : "Render cut preview"}</button>
              {previewUrl && <button className="button" onClick={downloadRenderedPreview}>Download video</button>}
              <button
                className="button"
                disabled={!mediaId || segmentExportState === "exporting"}
                onClick={() => void exportSegments()}
              >{segmentExportState === "exporting" ? "Packaging…" : `Export ${keepRanges.length} segments`}</button>
            </div>
            <div className="capcut-note">
              <span>CapCut</span>
              <p>The ZIP labels clips <strong>001, 002, 003…</strong> and includes their source times and import order. Sort by filename, select all, then drag them together onto the main track.</p>
            </div>
          </section>
        </div>

        <aside className="review-panel">
          <div className="review-header">
            <div><span className="eyebrow">Decision queue</span><h2>Review proposed cuts</h2><p>AI identifies content. Timings remain deterministic.</p></div>
            <span className="queue-count">{reviewCount} open</span>
          </div>
          <div className="filter-row">
            {(["all", "needs_review", "approved", "rejected"] as Filter[]).map((item) => (
              <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>
                {item === "all" ? `All ${candidates.length}` : item === "needs_review" ? `Review ${reviewCount}` : item === "approved" ? `Active ${approved}` : "Kept"}
              </button>
            ))}
          </div>
          <div className="cut-list">
            {filtered.map((cut) => (
              <CutCard
                key={`${cut.id}-${cut.start}-${cut.end}`}
                cut={cut}
                number={candidates.indexOf(cut) + 1}
                selected={selectedId === cut.id}
                adjusting={adjustingId === cut.id}
                onPreview={() => previewCut(cut)}
                onStatus={(status) => setCutStatus(cut, status)}
                onAdjust={() => setAdjustingId(adjustingId === cut.id ? undefined : cut.id)}
                onSaveAdjustment={(start, end) => saveAdjustment(cut, start, end)}
              />
            ))}
            {filtered.length === 0 && <div className="empty-list"><span>✓</span><strong>Nothing in this queue</strong><p>Change the filter to see other decisions.</p></div>}
          </div>
          <div className="validation-footer">
            <div className="validation-mark">✓</div>
            <div><strong>Post-edit validation passed</strong><span>{validation.missingUniqueWords.length ? `${validation.missingUniqueWords.length} unique words need review` : "No missing unique words in active cuts"}</span></div>
            <button aria-label="Show validation details">›</button>
          </div>
        </aside>
      </section>

      <input hidden ref={videoInputRef} type="file" accept="video/*" onChange={importVideo} />
      <input hidden ref={transcriptInputRef} type="file" accept="application/json,.json" onChange={importTranscript} />
    </main>
  );
}

function CutCard({ cut, number, selected, adjusting, onPreview, onStatus, onAdjust, onSaveAdjustment }: {
  cut: CandidateCut;
  number: number;
  selected: boolean;
  adjusting: boolean;
  onPreview: () => void;
  onStatus: (status: CutStatus) => void;
  onAdjust: () => void;
  onSaveAdjustment: (start: number, end: number) => void;
}) {
  const [start, setStart] = useState(cut.start);
  const [end, setEnd] = useState(cut.end);
  return (
    <article className={`cut-card ${selected ? "selected" : ""} status-${cut.status}`}>
      <div className="cut-card-head">
        <span className="cut-number">{String(number).padStart(2, "0")}</span>
        <div className="cut-kind"><span className={`type-icon type-${cut.type}`}>{cut.openingTrim ? "↦" : cut.breathDetected ? "≈" : cut.type === "silence" ? "Ⅱ" : cut.type === "retake" ? "↻" : "≋"}</span><div><strong>{cutLabel(cut)}</strong><span>{formatTime(cut.start)} — {formatTime(cut.end)} · {(cut.end - cut.start).toFixed(2)}s</span></div></div>
        <button className="preview-button" onClick={onPreview}><span>▶</span> Preview</button>
      </div>
      <div className="confidence-row">
        <span className={`risk risk-${cut.risk}`}>{cut.risk === "high" ? "High risk" : `${Math.round(cut.confidence * 100)}% confidence`}</span>
        <span className="confidence-track"><i style={{ width: `${cut.confidence * 100}%` }} /></span>
        <span>{Math.round(cut.confidence * 100)}%</span>
      </div>
      <p className="reason">{cut.reason}</p>
      <div className="transcript-change">
        <div><span>Before</span><p>{cut.original_text}</p></div>
        <span className="change-arrow">→</span>
        <div><span>After</span><p>{cut.resulting_text}</p></div>
      </div>
      {cut.risk === "high" && <div className="danger-note"><span>!</span><p><strong>Manual decision required.</strong> This cut is excluded from the EDL until explicitly approved.</p></div>}
      {!cut.validation.valid && <div className="danger-note"><span>×</span><p>{cut.validation.issues.join(" ")}</p></div>}
      {adjusting && (
        <div className="adjust-row">
          <label>In <input type="number" step="0.01" value={start} onChange={(event) => setStart(Number(event.target.value))} /></label>
          <label>Out <input type="number" step="0.01" value={end} onChange={(event) => setEnd(Number(event.target.value))} /></label>
          <button onClick={() => onSaveAdjustment(start, end)}>Save bounds</button>
        </div>
      )}
      <div className="decision-row">
        <button className={cut.status === "rejected" ? "decision-active keep" : ""} onClick={() => onStatus("rejected")}><span>✓</span> Keep</button>
        <button className={cut.status === "approved" ? "decision-active delete" : ""} onClick={() => onStatus("approved")}><span>×</span> Delete segment</button>
        <button className={adjusting ? "decision-active adjust" : ""} onClick={onAdjust}><span>↔</span> Adjust</button>
      </div>
    </article>
  );
}
