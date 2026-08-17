# Roughcut

Local-first talking-head rough-cut review workspace. It turns word-timestamped speech analysis into deterministic, reviewable cut candidates, renders the approved edit, and exports a JSON EDL or individually editable source segments. It can run as a web workspace with a local companion or as a packaged macOS/Windows desktop app.

## Phase 1 architecture

- `app/lib/editing/engine.mjs` contains the pure cut generator, exact timestamp mapping, EDL construction, and post-edit validation.
- `app/lib/editing/sample.ts` is a representative timed-word fixture plus semantic retake hints.
- `app/RoughcutWorkspace.tsx` is the local video, timeline, review, correction, safety-setting, and export UI.
- `transcription/server.mjs` is a loopback-only media service that keeps the active source in a temporary project directory for transcription/rendering, then removes it when the video is replaced or the workspace closes.
- `transcription/transcribe-cross-platform.mjs` runs Whisper locally through ONNX on macOS and Windows and emits word timestamps without uploading source media.
- `transcription/audio-analysis.mjs` provides portable silence, waveform, render-verification, and breath analysis in 10 ms frames.
- `app/lib/editing/retakes.mjs` identifies nearby repeated openings and likely final takes; unmatched earlier information remains visible as high-risk evidence.
- `app/lib/transcription/script-assistance.mjs` aligns supplied script lines with spoken word sequences, including incomplete starts, inserted fillers, small wording changes, and commonly transcribed number forms. When a line has multiple nearby takes, it keeps the final detected take—even when transcription makes that take look slightly less complete—while preserving unique earlier wording as risk evidence and sending only word-index retake hints to the deterministic cut engine.
- Bundled FFmpeg renders approved EDL ranges from the original video while automatically measuring and compensating for source audio/video edit-list offsets.
- The timestamp inspector displays real audio-energy peaks beneath word-level transcript blocks, follows source playback, and supports click-to-seek comparison at adjustable time scales.
- The paragraph transcript provides readable source and after-cuts views, highlights words removed by the active EDL, and keeps every visible word linked to its source timestamp.
- Low-confidence English wording receives conservative local correction suggestions. Only replacements confirmed by high-confidence vocabulary elsewhere in the same transcript apply automatically; standalone spelling guesses wait for acceptance. Corrections affect only the reading layer, remain visibly marked, are exported alongside immutable originals, and are reversible individually or all at once.
- `transcription/analyze_silence.py` measures the completed preview and reports any remaining gaps above 200 ms back to the review UI.
- `transcription/export-package.mjs` labels kept ranges as `001`, `002`, `003` and creates the CapCut import manifest and guide.
- `app/api/corrections/route.ts` saves human approvals, rejections, and boundary adjustments.
- `db/schema.ts` stores reviewer corrections in D1/SQLite.
- `tests/edit-engine.test.mjs` covers rule behavior independently of the UI.

The semantic layer decides which word spans are likely repetitions or retakes. It supplies word-index hints only. The editing engine derives every second-level boundary from word timestamps or verified silent audio and rejects unverified boundaries inside speech. Sentence entrances retain a configurable 100 ms pre-roll before the measured audio onset, even when the word timestamp is late. When transcript and audio identify the same pause, the measured silent-audio region is authoritative and suppresses any second transcript-only cut. An unconfirmed transcript gap must exceed 700 ms before it can be used as a conservative fallback, protecting late-timestamped word attacks in phrases such as “Forgive” and rapidly spoken contractions.

Every proposed cut is approved by default, including high-risk semantic cuts and candidates carrying safety warnings. High-risk evidence remains visible in the queue, and the reviewer can choose **Keep** to restore that section. Candidates whose exact boundaries fail timestamp safety remain approved in the queue but are blocked from rendering so they cannot clip speech.

Opening-word recognition can recover a low-confidence first word when it begins a contiguous, confident speech run. Measured audio activity is a hard upper limit for the opening trim, so uncertain words are preserved as soon as the leading silence ends; the first detected sound still keeps configured safety pre-roll.

Breath evidence is treated as a pause cue, not as an independent cut boundary. The detector identifies the sound, then the editing engine maps the removal to the surrounding word timestamps and applies the same padding and transition validation as every other pause.

For the head of each video, Roughcut selects the first recognizable word using transcript confidence and non-speech-token filtering. Bracketed sound labels, music markers, punctuation-only output, and low-confidence leading noise are removed with the opening trim. If every word is uncertain, it falls back to the earliest lexical token rather than risk clipping real speech.

## Run locally

Requires Node.js 22.13 or newer.

```bash
pnpm install
pnpm run db:migrate:local
pnpm run dev
```

Open `http://localhost:3000`.

Import a video first. Roughcut then asks for the optional recording script; choose **Analyze with script** to use it for transcription correction and stronger retake detection, or **Continue without script**. A newly imported video always receives a fresh script prompt so an earlier project’s script cannot be reused accidentally. The first transcription run downloads the configured Whisper model (about 164 MB), then reuses the on-device cache. Video and temporary audio stay on the device and are removed from the transcription service after each request. Use `ROUGHCUT_WHISPER_MODEL` to select another Transformers.js-compatible Whisper model and `ROUGHCUT_WHISPER_LANGUAGE` to force a language.

## Desktop installers

The Electron desktop app opens the same review workspace and starts its private media service automatically. Source video, extracted audio, transcription, preview rendering, and segment packaging remain on the computer; saved reviewer corrections continue to use the hosted workspace.

```bash
pnpm desktop:dev
pnpm desktop:dist --mac --arm64
pnpm desktop:dist:win
```

Installer artifacts are written to `release/`. The desktop build workflow produces separate Apple Silicon and Windows x64 downloads so every installer contains the correct native FFmpeg and ONNX runtime. Local macOS builds receive a complete ad-hoc signature so the bundle passes integrity verification, but they still require right-clicking the app and choosing **Open** on the first launch. Warning-free public distribution requires Apple Developer ID signing and notarization; Windows distribution should likewise add code signing.

The Windows build is an NSIS `.exe` installer, not a portable ZIP. CI installs that `.exe` silently on a Windows runner, starts the installed application, and verifies that the packaged app and its local media service initialize successfully. GitHub may wrap CI test artifacts in a ZIP for transport, but a tagged draft release exposes the `.exe` itself as a direct installer download.

## Shipping updates to reviewer computers

Roughcut updates travel on two separate tracks, and most changes never require a reinstall.

| Changed area | How reviewers receive it |
| --- | --- |
| `app/**` — review UI, cut engine, retake and script assistance | Redeploy the hosted workspace. The desktop shell loads that URL at launch, so reviewers only reopen the app. |
| `transcription/**`, `desktop/**`, dependencies | Publish a new installer. |

### Publishing an installer

1. Raise `version` in `package.json`.
2. Push a matching tag: `git tag v0.1.3 && git push origin v0.1.3`.
3. `.github/workflows/desktop-build.yml` builds Apple Silicon and Windows x64, then attaches the installers and `latest.yml` to a **draft** GitHub release. Running the workflow manually only builds; it never publishes.
4. Review the draft on GitHub and publish it. Nothing reaches reviewers until this step.

Set `build.publish.owner` in `package.json` and `UPDATE_REPOSITORY` in `desktop/main.mjs` to the repository that hosts the releases.

### How each platform updates

- **Windows** checks the published release on launch, downloads it in the background, and offers a restart when it is ready.
- **macOS** builds are unsigned, so Squirrel.Mac refuses to replace the app automatically. Roughcut instead reports that a newer version exists and opens the release page so the reviewer can drag the new app into Applications. Signing with an Apple Developer certificate is what would enable silent macOS updates.

Both checks fail quietly: an offline machine or an unreachable release feed never blocks startup.

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
