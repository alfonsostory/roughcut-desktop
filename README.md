# Roughcut

Local-first talking-head rough-cut review workspace. It turns word-timestamped speech analysis into deterministic, reviewable cut candidates, renders the approved edit, and exports a JSON EDL or individually editable source segments.

## Phase 1 architecture

- `app/lib/editing/engine.mjs` contains the pure cut generator, exact timestamp mapping, EDL construction, and post-edit validation.
- `app/lib/editing/sample.ts` is a representative timed-word fixture plus semantic retake hints.
- `app/RoughcutWorkspace.tsx` is the local video, timeline, review, correction, safety-setting, and export UI.
- `transcription/server.mjs` is a loopback-only media service that keeps the active source in a temporary project directory for transcription/rendering, then removes it when the video is replaced or the workspace closes.
- `transcription/transcribe.py` runs MLX Whisper locally, emits word timestamps, and measures -40 dB silence regions in 10 ms frames.
- `transcription/breath_detection.py` detects sustained breath-like broadband audio only inside gaps between timed words, so breathing can be shortened as a pause without crossing speech.
- `app/lib/editing/retakes.mjs` identifies nearby repeated openings and likely final takes; unmatched earlier information remains visible as high-risk evidence.
- `transcription/render.swift` renders approved EDL ranges from the original video while automatically compensating for source audio/video edit-list offsets.
- The timestamp inspector displays real audio-energy peaks beneath word-level transcript blocks, follows source playback, and supports click-to-seek comparison at adjustable time scales.
- `transcription/analyze_silence.py` measures the completed preview and reports any remaining gaps above 200 ms back to the review UI.
- `transcription/export-package.mjs` labels kept ranges as `001`, `002`, `003` and creates the CapCut import manifest and guide.
- `app/api/corrections/route.ts` saves human approvals, rejections, and boundary adjustments.
- `db/schema.ts` stores reviewer corrections in D1/SQLite.
- `tests/edit-engine.test.mjs` covers rule behavior independently of the UI.

The semantic layer decides which word spans are likely repetitions or retakes. It supplies word-index hints only. The editing engine derives every second-level boundary from word timestamps or verified silent audio, protects 90 ms on both sides of speech, and rejects unverified boundaries inside speech.

Every proposed cut is approved by default, including high-risk semantic cuts and candidates carrying safety warnings. High-risk evidence remains visible in the queue, and the reviewer can choose **Keep** to restore that section. Candidates whose exact boundaries fail timestamp safety remain approved in the queue but are blocked from rendering so they cannot clip speech.

Opening-word recognition can recover a low-confidence first word when it begins a contiguous, confident speech run. Measured audio activity is a hard upper limit for the opening trim, so uncertain words are preserved as soon as the leading silence ends; the first detected sound still keeps configured safety pre-roll.

Breath evidence is treated as a pause cue, not as an independent cut boundary. The detector identifies the sound, then the editing engine maps the removal to the surrounding word timestamps and applies the same padding and transition validation as every other pause.

For the head of each video, Roughcut selects the first recognizable word using transcript confidence and non-speech-token filtering. Bracketed sound labels, music markers, punctuation-only output, and low-confidence leading noise are removed with the opening trim. If every word is uncertain, it falls back to the earliest lexical token rather than risk clipping real speech.

## Run locally

Requires Node.js 22.13 or newer.

```bash
pnpm install
pnpm run transcribe:setup
pnpm run db:migrate:local
pnpm run dev
```

Open `http://localhost:3000`.

Importing a video now starts local word-timestamp transcription automatically. The first run downloads the configured Whisper model. Video and temporary audio stay on the device and are removed from the transcription service after each request. Use `ROUGHCUT_WHISPER_MODEL` to select another MLX Whisper model and `ROUGHCUT_WHISPER_LANGUAGE` to force a language; language detection is automatic by default.

## Manual transcript fallback

The timed-transcript JSON importer remains available if the local transcription companion is unavailable. JSON shape:

```json
{
  "duration": 33.4,
  "words": [
    { "word": "Hello", "start": 0.42, "end": 0.76, "confidence": 0.97 }
  ],
  "semantic_hints": [
    {
      "kind": "retake",
      "earlierWordRange": [0, 4],
      "keptWordRange": [5, 12],
      "confidence": 0.94,
      "reason": "Incomplete take followed by a complete take.",
      "uniqueTerms": []
    }
  ]
}
```

The local transcriber emits this adapter format and does not choose exact edit boundaries. The review UI and deterministic editing engine continue to own cut generation and validation.

## Render and CapCut workflow

The calibrated default preset shortens detected speech gaps above 200 ms toward 180 ms. After reviewing the cut queue:

1. Choose **Render cut preview** to build and play the active edit without replacing the source viewer.
2. Switch between **Source** and **Cut preview** to compare the result.
3. After a preview exists, any **Keep**, **Delete segment**, boundary adjustment, or safety-setting change automatically renders a fresh preview from the updated EDL.
4. Choose **Download video** for a single rough-cut MP4.
5. Choose **Export segments** for a ZIP containing individually editable, zero-padded MP4 clips, `manifest.json`, and `CAPCUT_IMPORT.txt`.
6. In CapCut Desktop, import the numbered MP4 files, sort by filename, select all, and drag them together to the main track.

CapCut currently does not support importing third-party EDL/XML project timelines, so Roughcut does not modify CapCut's private draft files. Numbered clips are the supported, recoverable handoff; their filenames and manifest preserve the intended timeline order.

## Calibrate from a reference edit

To compare a source transcript with a manually edited reference transcript, run:

```bash
pnpm run calibrate:reference -- source-transcript.json edited-transcript.json
```

The calibration aligns matching words, measures human pause compression, reports substantial removed speech spans, and recommends only values allowed by Roughcut's safety rules. The current reference-calibrated defaults use a 200 ms maximum, a 180 ms target, and 90 ms of protection on each speech side.

## Verify

```bash
pnpm run test
pnpm exec tsc --noEmit
pnpm run lint
```
