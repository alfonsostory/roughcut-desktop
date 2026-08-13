import argparse
import json
import os
import wave
from pathlib import Path

import mlx_whisper
import numpy as np


def detect_audio_silences(
    samples,
    sample_rate=16000,
    frame_duration=0.01,
    threshold_db=-40.0,
    minimum_duration=0.2,
):
    frame_size = round(sample_rate * frame_duration)
    levels = []
    for offset in range(0, len(samples) - frame_size + 1, frame_size):
        frame = samples[offset : offset + frame_size]
        rms = np.sqrt(np.mean(frame * frame) + 1e-12)
        levels.append(float(20 * np.log10(rms)))

    silences = []
    start_frame = None
    for index, level in enumerate(levels + [0.0]):
        if level < threshold_db and start_frame is None:
            start_frame = index
        elif level >= threshold_db and start_frame is not None:
            start = start_frame * frame_duration
            end = index * frame_duration
            if end - start > minimum_duration + 0.001:
                silences.append({
                    "start": round(start, 3),
                    "end": round(end, 3),
                    "duration": round(end - start, 3),
                    "minimum_db": round(min(levels[start_frame:index]), 2),
                })
            start_frame = None
    return silences


def load_audio(path: Path):
    try:
        with wave.open(str(path), "rb") as audio_file:
            duration = audio_file.getnframes() / audio_file.getframerate()
            if (
                audio_file.getnchannels() != 1
                or audio_file.getframerate() != 16000
                or audio_file.getsampwidth() != 2
            ):
                raise ValueError("Expected mono 16 kHz, 16-bit PCM audio")
            samples = np.frombuffer(
                audio_file.readframes(audio_file.getnframes()), dtype="<i2"
            ).astype(np.float32) / 32768.0
    except wave.Error:
        # afconvert may write WAVE_FORMAT_EXTENSIBLE for mono sources, which
        # Python 3.9's wave module cannot decode even though the PCM is valid.
        from scipy.io import wavfile

        sample_rate, pcm = wavfile.read(path)
        if sample_rate != 16000 or pcm.ndim != 1 or pcm.dtype != np.int16:
            raise ValueError("Expected mono 16 kHz, 16-bit PCM audio")
        duration = len(pcm) / sample_rate
        samples = pcm.astype(np.float32) / 32768.0
    return duration, samples


def main():
    parser = argparse.ArgumentParser(description="Create Roughcut word timestamps")
    parser.add_argument("audio", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    duration, audio_samples = load_audio(args.audio)
    model = os.environ.get("ROUGHCUT_WHISPER_MODEL", "mlx-community/whisper-tiny")
    language = os.environ.get("ROUGHCUT_WHISPER_LANGUAGE")
    options = {
        "path_or_hf_repo": model,
        "word_timestamps": True,
        "verbose": False,
        "condition_on_previous_text": True,
        "hallucination_silence_threshold": 1.0,
    }
    if language and language.lower() != "auto":
        options["language"] = language

    result = mlx_whisper.transcribe(audio_samples, **options)
    words = []
    for segment in result.get("segments", []):
        for item in segment.get("words", []):
            token = item.get("word", "").strip()
            start = item.get("start")
            end = item.get("end")
            if not token or start is None or end is None or end <= start:
                continue
            word = {
                "word": token,
                "start": round(float(start), 3),
                "end": round(float(end), 3),
            }
            probability = item.get("probability")
            if probability is not None:
                word["confidence"] = round(float(probability), 4)
            words.append(word)

    payload = {
        "duration": round(duration, 3),
        "language": result.get("language"),
        "text": result.get("text", "").strip(),
        "words": words,
        "semantic_hints": [],
        "audio_analysis": {
            "frame_duration": 0.01,
            "silence_threshold_db": -40.0,
            "minimum_silence": 0.2,
            "silences": detect_audio_silences(audio_samples),
        },
        "transcription": {
            "engine": "mlx-whisper",
            "model": model,
            "word_timestamps": True,
        },
    }
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
