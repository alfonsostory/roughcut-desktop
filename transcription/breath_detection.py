import numpy as np


def _frame_features(frame, sample_rate):
    rms = np.sqrt(np.mean(frame * frame) + 1e-12)
    level_db = float(20 * np.log10(rms))
    zero_crossing_rate = float(np.mean(np.signbit(frame[1:]) != np.signbit(frame[:-1])))

    windowed = frame * np.hanning(len(frame))
    power = np.abs(np.fft.rfft(windowed)) ** 2 + 1e-12
    frequencies = np.fft.rfftfreq(len(frame), 1 / sample_rate)
    audible = (frequencies >= 120) & (frequencies <= 7000)
    high = (frequencies >= 900) & (frequencies <= 7000)
    audible_power = float(np.sum(power[audible])) + 1e-12
    high_ratio = float(np.sum(power[high]) / audible_power)
    audible_bins = power[audible]
    flatness = float(np.exp(np.mean(np.log(audible_bins))) / np.mean(audible_bins))
    return level_db, zero_crossing_rate, high_ratio, flatness


def detect_audio_breaths(
    samples,
    words,
    sample_rate=16000,
    frame_duration=0.03,
    hop_duration=0.01,
    minimum_duration=0.12,
    minimum_gap=0.18,
):
    """Find breath-like broadband noise only inside timestamp-confirmed word gaps."""
    frame_size = round(sample_rate * frame_duration)
    hop_size = round(sample_rate * hop_duration)
    breaths = []

    for previous, following in zip(words, words[1:]):
        gap_start = float(previous["end"])
        gap_end = float(following["start"])
        if gap_end - gap_start <= minimum_gap + 0.001:
            continue

        first_offset = max(0, round(gap_start * sample_rate))
        last_offset = min(len(samples), round(gap_end * sample_rate))
        breath_frames = []
        for offset in range(first_offset, last_offset - frame_size + 1, hop_size):
            frame = samples[offset : offset + frame_size]
            level_db, zero_crossing_rate, high_ratio, flatness = _frame_features(frame, sample_rate)
            is_breath = (
                -42.0 <= level_db <= -14.0
                and zero_crossing_rate >= 0.045
                and high_ratio >= 0.42
                and flatness >= 0.12
            )
            if is_breath:
                breath_frames.append({
                    "start": offset / sample_rate,
                    "end": (offset + frame_size) / sample_rate,
                    "level_db": level_db,
                    "high_ratio": high_ratio,
                    "flatness": flatness,
                })

        if not breath_frames:
            continue

        groups = [[breath_frames[0]]]
        for frame in breath_frames[1:]:
            if frame["start"] <= groups[-1][-1]["end"] + 0.031:
                groups[-1].append(frame)
            else:
                groups.append([frame])

        for group in groups:
            start = max(gap_start, group[0]["start"])
            end = min(gap_end, group[-1]["end"])
            if end - start < minimum_duration - 0.001:
                continue
            mean_high_ratio = float(np.mean([frame["high_ratio"] for frame in group]))
            mean_flatness = float(np.mean([frame["flatness"] for frame in group]))
            mean_db = float(np.mean([frame["level_db"] for frame in group]))
            confidence = min(
                0.97,
                0.72
                + min(0.12, (end - start - minimum_duration) * 0.4)
                + min(0.08, max(0.0, mean_high_ratio - 0.42) * 0.4)
                + min(0.05, max(0.0, mean_flatness - 0.12) * 0.25),
            )
            breaths.append({
                "start": round(start, 3),
                "end": round(end, 3),
                "duration": round(end - start, 3),
                "confidence": round(confidence, 3),
                "mean_db": round(mean_db, 2),
                "evidence": "broadband_nonverbal_audio_between_words",
            })

    return breaths
