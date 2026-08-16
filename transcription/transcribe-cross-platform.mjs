import { env, pipeline } from "@huggingface/transformers";
import {
  createWaveformPeaks,
  detectAudioBreaths,
  detectAudioSilences,
  readPcmWav,
} from "./audio-analysis.mjs";

const transcribers = new Map();

async function getTranscriber(model) {
  if (process.env.ROUGHCUT_MODEL_CACHE) env.cacheDir = process.env.ROUGHCUT_MODEL_CACHE;
  if (!transcribers.has(model)) {
    transcribers.set(model, pipeline("automatic-speech-recognition", model, {
      device: "cpu",
    }));
  }
  return transcribers.get(model);
}

export async function transcribeWav(audioPath) {
  const { samples, sampleRate, duration } = await readPcmWav(audioPath);
  if (sampleRate !== 16000) throw new Error("The transcription runtime expects 16 kHz audio.");
  const model = process.env.ROUGHCUT_WHISPER_MODEL ?? "Xenova/whisper-tiny";
  const language = process.env.ROUGHCUT_WHISPER_LANGUAGE;
  const transcriber = await getTranscriber(model);
  const result = await transcriber(samples, {
    return_timestamps: "word",
    chunk_length_s: 30,
    stride_length_s: 5,
    task: "transcribe",
    ...(language && language.toLowerCase() !== "auto" ? { language } : {}),
  });

  const words = (result.chunks ?? []).flatMap((chunk) => {
    const token = String(chunk.text ?? "").trim();
    const start = Number(chunk.timestamp?.[0]);
    const rawEnd = Number(chunk.timestamp?.[1]);
    const end = Math.min(duration, rawEnd);
    return token && Number.isFinite(start) && Number.isFinite(end) && start < duration && end > start
      ? [{ word: token, start: Number(Math.max(0, start).toFixed(3)), end: Number(end.toFixed(3)) }]
      : [];
  });

  return {
    duration: Number(duration.toFixed(3)),
    language: language && language.toLowerCase() !== "auto" ? language : undefined,
    text: String(result.text ?? "").trim(),
    words,
    semantic_hints: [],
    transcript_corrections: [],
    audio_analysis: {
      frame_duration: 0.01,
      silence_threshold_db: -40,
      minimum_silence: 0.2,
      silences: detectAudioSilences(samples, sampleRate),
      breaths: detectAudioBreaths(samples, words, sampleRate),
      waveform_peaks: createWaveformPeaks(samples),
      breath_detection: {
        minimum_duration: 0.12,
        minimum_word_gap: 0.18,
        mode: "broadband_audio_between_timed_words",
      },
    },
    transcription: {
      engine: "transformers-whisper",
      model,
      word_timestamps: true,
      local: true,
    },
  };
}
