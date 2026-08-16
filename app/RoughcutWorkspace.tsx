"use client";
/* eslint-disable jsx-a11y/media-has-caption -- Phase 1 intentionally does not create caption tracks. */

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { resolvePreviewRefreshAction, shouldQueueAutomaticPreviewRefresh } from "./lib/editing/preview.mjs";
import { SAMPLE_DURATION, sampleSemanticHints, sampleWords } from "./lib/editing/sample";
import { findFirstRecognizableWord, normalizeTranscriptPayload, type TranscriptCorrection, type TranscriptPayload } from "./lib/transcription/normalize.mjs";
import { analyzeSupportingScript, applyTranscriptCorrections } from "./lib/transcription/script-assistance.mjs";
import TranscriptWaveform from "./TranscriptWaveform";
import TranscriptParagraph from "./TranscriptParagraph";

type Filter = "all" | "approved" | "rejected";
type TranscriptionState = "idle" | "transcribing" | "ready" | "error";
type RenderState = "idle" | "rendering" | "ready" | "error";
type SegmentExportState = "idle" | "exporting" | "error";
type ScriptAnalysisSummary = {
  scriptWordCount: number;
  matchedWordCount: number;
  correctionCount: number;
  retakeCount: number;
};

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
const sampleWaveformPeaks = waveform.map((height) => height / 100);

export default function RoughcutWorkspace() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const transcriptInputRef = useRef<HTMLInputElement>(null);
  const sourceFileRef = useRef<File | undefined>(undefined);
  const transcriptionAbortRef = useRef<AbortController | undefined>(undefined);
  const renderedEdlRef = useRef<string | undefined>(undefined);
  const autoRenderAfterChangeRef = useRef(false);
  const renderRequestIdRef = useRef(0);
  const [videoUrl, setVideoUrl] = useState<string>();
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [viewMode, setViewMode] = useState<"source" | "preview">("source");
  const [mediaId, setMediaId] = useState<string>();
  const [fileName, setFileName] = useState("founder_interview_take_04.mp4");
  const [words, setWords] = useState<WordTimestamp[]>(sampleWords);
  const [hints, setHints] = useState<SemanticHint[]>(sampleSemanticHints);
  const [audioSilences, setAudioSilences] = useState<AudioSilence[]>([]);
  const [audioBreaths, setAudioBreaths] = useState<AudioBreath[]>([]);
  const [waveformPeaks, setWaveformPeaks] = useState<number[]>(sampleWaveformPeaks);
  const [transcriptCorrections, setTranscriptCorrections] = useState<TranscriptCorrection[]>([]);
  const [supportingScript, setSupportingScript] = useState("");
  const [analyzedScript, setAnalyzedScript] = useState("");
  const [scriptAnalysis, setScriptAnalysis] = useState<ScriptAnalysisSummary>();
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
  const [renderNote, setRenderNote] = useState("All proposed cuts are approved · timestamp-unsafe boundaries remain blocked from rendering");
  const [hasSourceFile, setHasSourceFile] = useState(false);
  const [playbackTime, setPlaybackTime] = useState(0);

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
  const effectiveWords = useMemo(
    () => applyTranscriptCorrections(words, transcriptCorrections),
    [transcriptCorrections, words],
  );
  const edl = useMemo(() => buildEdl(duration, candidates), [duration, candidates]);
  const keepRanges = useMemo(
    () => edl.filter((range) => range.action === "keep").map(({ start, end }) => ({ start, end })),
    [edl],
  );
  const edlSignature = useMemo(() => JSON.stringify(keepRanges), [keepRanges]);
  const validation = useMemo(
    () => validateEditedResult(effectiveWords, candidates, config),
    [effectiveWords, candidates, config],
  );
  const approved = candidates.filter((cut) => cut.status === "approved").length;
  const blocked = candidates.filter((cut) => cut.status === "approved" && !cut.validation.valid).length;
  const removedDuration = edl
    .filter((range) => range.action === "remove")
    .reduce((sum, range) => sum + range.end - range.start, 0);
  const trimmedSupportingScript = supportingScript.trim();
  const scriptChangedSinceAnalysis = trimmedSupportingScript !== analyzedScript;
  const supportingScriptWordCount = trimmedSupportingScript
    ? trimmedSupportingScript.split(/\s+/).filter(Boolean).length
    : 0;

  const queueAutomaticPreviewRefresh = () => {
    if (shouldQueueAutomaticPreviewRefresh(renderedEdlRef.current, mediaId)) {
      autoRenderAfterChangeRef.current = true;
    }
  };

  const previewCut = (cut: CandidateCut) => {
    setSelectedId(cut.id);
    setViewMode("source");
    setPlaybackTime(Math.max(0, cut.start - 1.2));
    if (!videoRef.current || !videoUrl) return;
    videoRef.current.src = videoUrl;
    videoRef.current.currentTime = Math.max(0, cut.start - 1.2);
    void videoRef.current.play();
    window.setTimeout(() => videoRef.current?.pause(), Math.max(1200, (cut.end - cut.start + 2.4) * 1000));
  };

  const seekSource = (time: number) => {
    const target = Math.max(0, Math.min(duration, time));
    setViewMode("source");
    setPlaybackTime(target);
    if (!videoRef.current || !videoUrl) return;
    videoRef.current.src = videoUrl;
    videoRef.current.currentTime = target;
  };

  const setTranscriptCorrectionStatus = (
    wordIndex: number | "all",
    status: TranscriptCorrection["status"],
  ) => {
    setTranscriptCorrections((current) => current.map((correction) =>
      wordIndex === "all" || correction.word_index === wordIndex
        ? { ...correction, status }
        : correction,
    ));
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
    if (cut.status === status) return;
    queueAutomaticPreviewRefresh();
    setCandidates((current) => current.map((item) =>
      item.id === cut.id
        ? { ...item, status, humanOverride: status === "approved" || item.humanOverride }
        : item,
    ));
    void persistCorrection(cut, status === "approved" ? "approved" : "rejected");
  };

  const saveAdjustment = (cut: CandidateCut, start: number, end: number) => {
    const checked = validateCut({ start, end }, effectiveWords, config);
    queueAutomaticPreviewRefresh();
    setCandidates((current) => current.map((item) =>
      item.id === cut.id
        ? { ...item, start, end, validation: checked, status: "approved", humanOverride: true }
        : item,
    ));
    setAdjustingId(undefined);
    void persistCorrection(cut, "adjusted", start, end);
  };

  const updateConfig = (key: keyof CutConfig, value: number) => {
    const next = { ...config, [key]: value };
    const openingWord = findFirstRecognizableWord(effectiveWords);
    queueAutomaticPreviewRefresh();
    setConfig(next);
    setCandidates(generateCandidateCuts(effectiveWords, hints, next, {
      duration,
      audioSilences,
      audioBreaths,
      openingWordIndex: openingWord.index,
      openingWordConfidence: openingWord.confidence,
      silenceThresholdDb,
    }));
  };

  const applyTranscript = (payload: TranscriptPayload, script = "") => {
    const normalized = normalizeTranscriptPayload(payload);
    const trimmedScript = script.trim();
    const scriptResult = analyzeSupportingScript(normalized.words, trimmedScript, {
      retakeWindow: config.retakeWindow,
    });
    const correctionsByIndex = new Map(normalized.transcript_corrections.map((correction) => [
      correction.word_index,
      correction,
    ]));
    for (const correction of scriptResult.corrections) {
      correctionsByIndex.set(correction.word_index, correction);
    }
    const combinedCorrections = [...correctionsByIndex.values()].sort((left, right) =>
      left.word_index - right.word_index);
    const correctedWords = applyTranscriptCorrections(normalized.words, combinedCorrections);
    const detectedRetakes = detectRetakeHints(correctedWords, { retakeWindow: config.retakeWindow });
    const semanticHints = mergeSemanticHints(
      normalized.semantic_hints,
      mergeSemanticHints(detectedRetakes, scriptResult.semanticHints),
    );
    const detectedSilences = normalized.audio_analysis?.silences ?? [];
    const detectedBreaths = normalized.audio_analysis?.breaths ?? [];
    const detectedThreshold = normalized.audio_analysis?.silence_threshold_db ?? -40;
    const openingWord = {
      ...normalized.opening_word,
      word: correctedWords[normalized.opening_word.index],
    };
    queueAutomaticPreviewRefresh();
    setWords(normalized.words);
    setHints(semanticHints);
    setAudioSilences(detectedSilences);
    setAudioBreaths(detectedBreaths);
    setWaveformPeaks(normalized.audio_analysis?.waveform_peaks ?? []);
    setTranscriptCorrections(combinedCorrections);
    setAnalyzedScript(trimmedScript);
    setScriptAnalysis(trimmedScript ? {
      scriptWordCount: scriptResult.scriptWordCount,
      matchedWordCount: scriptResult.matchedWordCount,
      correctionCount: scriptResult.corrections.length,
      retakeCount: scriptResult.semanticHints.length,
    } : undefined);
    setSilenceThresholdDb(detectedThreshold);
    setDuration(normalized.duration);
    setCandidates(generateCandidateCuts(correctedWords, semanticHints, config, {
      duration: normalized.duration,
      audioSilences: detectedSilences,
      audioBreaths: detectedBreaths,
      openingWordIndex: openingWord.index,
      openingWordConfidence: openingWord.confidence,
      silenceThresholdDb: detectedThreshold,
    }));
    setTranscriptionState("ready");
    const retakeCount = semanticHints.filter((hint) => hint.kind === "retake").length;
    const scriptNote = trimmedScript
      ? ` · script matched ${scriptResult.matchedWordCount}/${normalized.words.length} spoken words`
      : "";
    setImportNote(`${normalized.words.length} timed words · ${combinedCorrections.length} wording correction${combinedCorrections.length === 1 ? "" : "s"}${scriptNote} · starts at “${openingWord.word.word}” · ${detectedSilences.length} silences · ${detectedBreaths.length} breaths · ${retakeCount} likely retake${retakeCount === 1 ? "" : "s"}`);
  };

  const transcribeVideo = async (file: File, script = supportingScript) => {
    transcriptionAbortRef.current?.abort();
    const controller = new AbortController();
    transcriptionAbortRef.current = controller;
    setTranscriptionState("transcribing");
    const trimmedScript = script.trim();
    setImportNote(trimmedScript
      ? "Transcribing locally before script comparison…"
      : "Transcribing locally… first run may take a minute");
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
      if (sourceFileRef.current !== file || transcriptionAbortRef.current !== controller) return;
      if (!payload.media_id) throw new Error("Local media preparation did not return a project ID.");
      setMediaId(payload.media_id);
      applyTranscript(payload, trimmedScript);
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
    renderRequestIdRef.current += 1;
    renderedEdlRef.current = undefined;
    autoRenderAfterChangeRef.current = false;
    setVideoUrl(URL.createObjectURL(file));
    setPreviewUrl(undefined);
    setViewMode("source");
    setMediaId(undefined);
    setRenderState("idle");
    setSegmentExportState("idle");
    setRenderNote("All proposed cuts are approved · timestamp-unsafe boundaries remain blocked from rendering");
    setFileName(file.name);
    setWords([]);
    setHints([]);
    setAudioSilences([]);
    setAudioBreaths([]);
    setWaveformPeaks([]);
    setTranscriptCorrections([]);
    setCandidates([]);
    setSelectedId(undefined);
    setPlaybackTime(0);
    sourceFileRef.current = file;
    setHasSourceFile(true);
    setImportNote("Preparing local transcription…");
    void transcribeVideo(file, trimmedSupportingScript);
    event.target.value = "";
  };

  const reanalyzeCurrentVideo = () => {
    const file = sourceFileRef.current;
    if (!file) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (mediaId) void fetch(`${MEDIA_SERVICE_URL}/media/${mediaId}`, { method: "DELETE" });
    renderRequestIdRef.current += 1;
    renderedEdlRef.current = undefined;
    autoRenderAfterChangeRef.current = false;
    setPreviewUrl(undefined);
    setViewMode("source");
    setMediaId(undefined);
    setRenderState("idle");
    setRenderNote("All proposed cuts are approved · timestamp-unsafe boundaries remain blocked from rendering");
    setSelectedId(undefined);
    setPlaybackTime(0);
    void transcribeVideo(file, trimmedSupportingScript);
  };

  const handleVideoMetadata = () => {
    const mediaDuration = videoRef.current?.duration;
    if (mediaDuration && Number.isFinite(mediaDuration)) setDuration(mediaDuration);
  };

  const requestRenderedPreview = useCallback(async (options?: {
    ranges?: Array<{ start: number; end: number }>;
    signature?: string;
    automatic?: boolean;
  }) => {
    if (!mediaId) return;
    const ranges = options?.ranges ?? keepRanges;
    const signature = options?.signature ?? edlSignature;
    const requestId = renderRequestIdRef.current + 1;
    renderRequestIdRef.current = requestId;
    renderedEdlRef.current = signature;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(undefined);
    setViewMode("source");
    setRenderState("rendering");
    setRenderNote(options?.automatic ? "Updating preview after cut changes…" : "Rendering active cuts locally…");
    try {
      const response = await fetch(`${MEDIA_SERVICE_URL}/render`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ media_id: mediaId, duration, keep_ranges: ranges }),
      });
      if (!response.ok) {
        const payload = await response.json() as { error?: string };
        throw new Error(payload.error || "Preview render failed.");
      }
      const measuredSilenceMs = Number(response.headers.get("x-roughcut-max-silence-ms"));
      const remainingLongSilences = Number(response.headers.get("x-roughcut-long-silence-count"));
      const renderedVideo = await response.blob();
      if (requestId !== renderRequestIdRef.current) return;
      const nextUrl = URL.createObjectURL(renderedVideo);
      setPreviewUrl(nextUrl);
      renderedEdlRef.current = signature;
      setViewMode("preview");
      setRenderState("ready");
      setRenderNote(remainingLongSilences > 0
        ? `${ranges.length} segments · ${remainingLongSilences} pauses still exceed 200 ms`
        : `${ranges.length} segments · preview verified · longest silence ${measuredSilenceMs} ms`);
    } catch (error) {
      if (requestId !== renderRequestIdRef.current) return;
      renderedEdlRef.current = undefined;
      setRenderState("error");
      setRenderNote(error instanceof Error ? error.message : "Preview render failed.");
    }
  }, [duration, edlSignature, keepRanges, mediaId, previewUrl]);

  useEffect(() => {
    const renderedSignature = renderedEdlRef.current;
    const action = resolvePreviewRefreshAction({
      renderedSignature,
      nextSignature: edlSignature,
      automaticRequested: autoRenderAfterChangeRef.current,
      mediaId,
    });
    if (action === "none") return;

    if (action === "render") {
      autoRenderAfterChangeRef.current = false;
      renderedEdlRef.current = edlSignature;
      void requestRenderedPreview({
        ranges: keepRanges,
        signature: edlSignature,
        automatic: true,
      });
      return;
    }

    renderRequestIdRef.current += 1;
    renderedEdlRef.current = undefined;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(undefined);
    setViewMode("source");
    setRenderState("idle");
    setRenderNote("Cuts changed · render a fresh preview");
  }, [edlSignature, keepRanges, mediaId, previewUrl, requestRenderedPreview]);

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
      applyTranscript(JSON.parse(await file.text()) as TranscriptPayload, trimmedSupportingScript);
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
      transcript_corrections: transcriptCorrections,
      supporting_script: {
        provided: Boolean(analyzedScript),
        character_count: analyzedScript.length,
        word_count: scriptAnalysis?.scriptWordCount ?? 0,
        matched_spoken_words: scriptAnalysis?.matchedWordCount ?? 0,
        wording_corrections: scriptAnalysis?.correctionCount ?? 0,
        detected_retakes: scriptAnalysis?.retakeCount ?? 0,
      },
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
          <div><strong>{approved}/{candidates.length}</strong><span>cuts approved</span></div>
          <div className={validation.valid ? "healthy" : "warning"}><strong>{validation.valid ? "Meaning intact" : "Check meaning"}</strong><span>validation</span></div>
        </div>
      </section>

      <section className="workspace">
        <div className="viewer-column">
          <section className="script-card" aria-labelledby="supporting-script-heading">
            <div className="script-card-head">
              <div>
                <span className="eyebrow">Optional recording context</span>
                <h2 id="supporting-script-heading">Supporting script</h2>
                <p>Paste the script used during recording. It improves word selection and helps identify repeated takes of the same line.</p>
              </div>
              <span className={`script-state ${scriptChangedSinceAnalysis ? "pending" : analyzedScript ? "applied" : ""}`}>
                {transcriptionState === "transcribing"
                  ? "Analyzing"
                  : scriptChangedSinceAnalysis && hasSourceFile
                    ? "Reanalysis needed"
                    : analyzedScript
                      ? "Applied"
                      : trimmedSupportingScript
                        ? "Ready for import"
                        : "Optional"}
              </span>
            </div>
            <label className="script-input" htmlFor="supporting-script">
              <span>Recording script</span>
              <textarea
                id="supporting-script"
                value={supportingScript}
                maxLength={100000}
                rows={5}
                placeholder="Paste the intended lines here. Paragraphs and one-line-per-take scripts both work."
                onChange={(event) => setSupportingScript(event.target.value)}
              />
            </label>
            <div className="script-card-footer">
              <span>{supportingScriptWordCount.toLocaleString()} script words · exact cut boundaries still come from audio timestamps</span>
              <div>
                {trimmedSupportingScript && <button className="button" onClick={() => setSupportingScript("")}>Clear</button>}
                {hasSourceFile && (
                  <button
                    className="button button-primary"
                    disabled={transcriptionState === "transcribing" || !scriptChangedSinceAnalysis}
                    onClick={reanalyzeCurrentVideo}
                  >{trimmedSupportingScript ? "Apply & reanalyze" : "Reanalyze without script"}</button>
                )}
              </div>
            </div>
            {scriptAnalysis && !scriptChangedSinceAnalysis && (
              <div className="script-results" aria-label="Supporting script comparison results">
                <span><strong>{scriptAnalysis.matchedWordCount}/{words.length}</strong> spoken words matched</span>
                <span><strong>{scriptAnalysis.correctionCount}</strong> wording corrections</span>
                <span><strong>{scriptAnalysis.retakeCount}</strong> script-guided retakes</span>
              </div>
            )}
          </section>

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
                    if (sourceFile) void transcribeVideo(sourceFile, trimmedSupportingScript);
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
                  onTimeUpdate={(event) => {
                    if (viewMode === "source") setPlaybackTime(event.currentTarget.currentTime);
                  }}
                />
              ) : (
                <button className="empty-video" onClick={() => videoInputRef.current?.click()}>
                  <span className="play-orb">▶</span>
                  <strong>Attach the source video</strong>
                  <span>The demo analysis is ready. Your footage stays on this device.</span>
                </button>
              )}
              <div className="safe-badge"><span>✓</span> {viewMode === "preview" ? "Timestamp-safe approved cuts rendered" : "Word + audio-safe boundaries"}</div>
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
              <div className="legend"><span><i className="legend-remove" />Remove</span><span><i className="legend-review" />Kept</span></div>
            </div>
            <div className="ruler"><span>0:00</span><span>0:08</span><span>0:16</span><span>0:24</span><span>0:33</span></div>
            <div className="waveform" aria-label="Audio waveform and candidate cut positions">
              {waveform.map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}
              {candidates.map((cut) => (
                <button
                  key={cut.id}
                  className={`cut-marker ${cut.status === "rejected" ? "review" : ""} ${!cut.validation.valid ? "blocked" : ""} ${selectedId === cut.id ? "selected" : ""}`}
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
              <span><i className="status-check">✓</i> All proposed cuts approved by default</span>
            </div>
          </div>

          <TranscriptWaveform
            words={words}
            cuts={candidates}
            peaks={waveformPeaks}
            duration={duration}
            currentTime={playbackTime}
            onSeek={seekSource}
          />

          <TranscriptParagraph
            words={words}
            candidates={candidates}
            corrections={transcriptCorrections}
            currentTime={playbackTime}
            onSeek={seekSource}
            onCorrectionStatus={setTranscriptCorrectionStatus}
          />

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
            <div><span className="eyebrow">Decision queue</span><h2>Review proposed cuts</h2><p>Every proposed cut starts approved, including high-risk cuts. Choose Keep to restore a section.</p></div>
            <span className="queue-count">{approved} approved{blocked ? ` · ${blocked} safety-blocked` : ""}</span>
          </div>
          <div className="filter-row">
            {(["all", "approved", "rejected"] as Filter[]).map((item) => (
              <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>
                {item === "all" ? `All ${candidates.length}` : item === "approved" ? `Approved ${approved}` : "Kept"}
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
            <div><strong>{validation.valid ? "Post-edit validation passed" : "Post-edit warning detected"}</strong><span>{validation.missingUniqueWords.length ? `${validation.missingUniqueWords.length} unique words are removed by active cuts` : "No missing unique words in active cuts"}</span></div>
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
      {cut.risk === "high" && cut.validation.valid && <div className="danger-note"><span>!</span><p><strong>High-risk cut approved by default.</strong> Choose Keep if this section should remain.</p></div>}
      {!cut.validation.valid && <div className="danger-note"><span>×</span><p><strong>Approved by default, but blocked from rendering for timestamp safety.</strong> {cut.validation.issues.join(" ")}</p></div>}
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
