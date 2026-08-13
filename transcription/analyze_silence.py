import json
import sys
import wave
from pathlib import Path

import numpy as np


def load_pcm(path: Path):
    try:
        with wave.open(str(path), "rb") as audio_file:
            sample_rate = audio_file.getframerate()
            samples = np.frombuffer(
                audio_file.readframes(audio_file.getnframes()), dtype="<i2"
            )
    except wave.Error:
        from scipy.io import wavfile

        sample_rate, samples = wavfile.read(path)
    if samples.ndim > 1:
        samples = samples[:, 0]
    return sample_rate, samples.astype(np.float32) / 32768.0


def analyze(samples, sample_rate, threshold_db=-40.0, maximum_silence=0.2):
    frame_duration = 0.01
    frame_size = round(sample_rate * frame_duration)
    levels = []
    for offset in range(0, len(samples) - frame_size + 1, frame_size):
        frame = samples[offset : offset + frame_size]
        rms = np.sqrt(np.mean(frame * frame) + 1e-12)
        levels.append(float(20 * np.log10(rms)))

    runs = []
    start_frame = None
    for index, level in enumerate(levels + [0.0]):
        if level < threshold_db and start_frame is None:
            start_frame = index
        elif level >= threshold_db and start_frame is not None:
            duration = (index - start_frame) * frame_duration
            runs.append({
                "start": round(start_frame * frame_duration, 3),
                "end": round(index * frame_duration, 3),
                "duration": round(duration, 3),
            })
            start_frame = None

    return {
        "threshold_db": threshold_db,
        "maximum_allowed_silence": maximum_silence,
        "maximum_measured_silence": round(
            max((run["duration"] for run in runs), default=0), 3
        ),
        "long_silences": [
            run for run in runs if run["duration"] > maximum_silence + 0.001
        ],
    }


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: analyze_silence.py AUDIO_WAV OUTPUT_JSON")
    sample_rate, samples = load_pcm(Path(sys.argv[1]))
    Path(sys.argv[2]).write_text(
        json.dumps(analyze(samples, sample_rate), indent=2) + "\n"
    )
