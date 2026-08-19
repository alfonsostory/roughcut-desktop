import { createServer } from "node:http";
import { createWriteStream, existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { pipeline } from "node:stream/promises";
import archiver from "archiver";
import bundledFfmpegPath from "ffmpeg-static";
import {
  buildFormatAnalysisRequest,
  DEFAULT_FORMAT_MODEL,
  requestFormatAnalysis,
} from "../app/lib/format/analyze.mjs";
import { analyzeSilence, readPcmWav } from "./audio-analysis.mjs";
import { normalizeKeepRanges, segmentFileName, writePackageGuides } from "./export-package.mjs";
import {
  DEFAULT_FRAME_COUNT,
  FRAME_MAX_WIDTH,
  frameTimestamps,
  isImageUpload,
  parseFfmpegDuration,
} from "./format-frames.mjs";
import { transcribeWav } from "./transcribe-cross-platform.mjs";

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
const PORT = Number(process.env.ROUGHCUT_TRANSCRIBER_PORT ?? 4317);
const preparedMedia = new Map();

const json = (response, status, payload, origin) => {
  response.writeHead(status, {
    "access-control-allow-origin": origin,
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-private-network": "true",
  });
  response.end(JSON.stringify(payload));
};

const binary = (response, status, payload, origin, contentType, fileName, extraHeaders = {}) => {
  response.writeHead(status, {
    "access-control-allow-origin": origin,
    "access-control-expose-headers": "x-roughcut-max-silence-ms, x-roughcut-long-silence-count",
    "content-type": contentType,
    "content-disposition": `attachment; filename="${fileName.replace(/["\\]/g, "_")}"`,
    "content-length": payload.length,
    "cache-control": "no-store",
    ...extraHeaders,
  });
  response.end(payload);
};

const allowedOrigin = (request) => {
  const origin = request.headers.origin ?? "";
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
    || origin === "https://roughcut-phase-one-demo.alfonsostory.chatgpt.site"
    ? origin
    : "http://localhost:3000";
};

const ffmpegExecutable = () => {
  const configured = process.env.ROUGHCUT_FFMPEG ?? bundledFfmpegPath;
  if (!configured) throw new Error("The bundled FFmpeg executable is unavailable on this platform.");
  if (configured.includes("app.asar") && process.resourcesPath) {
    const unpacked = path.join(
      process.resourcesPath,
      "app.asar.unpacked",
      "node_modules",
      "ffmpeg-static",
      process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
    );
    if (existsSync(unpacked)) return unpacked;
  }
  return configured.replace("app.asar", "app.asar.unpacked");
};

const runCapture = (command, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout = `${stdout}${chunk}`.slice(-16000);
  });
  child.stderr.on("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-16000);
  });
  child.on("error", reject);
  child.on("exit", (code) => {
    if (code === 0) resolve({ stdout, stderr });
    else reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
  });
});

const run = async (command, args, options = {}) => {
  await runCapture(command, args, options);
};

const readJsonBody = async (request, maximumBytes = 2 * 1024 * 1024) => {
  const chunks = [];
  let received = 0;
  for await (const chunk of request) {
    received += chunk.length;
    if (received > maximumBytes) throw new Error("Request payload is too large.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

const safeBaseName = (fileName) => path.basename(fileName, path.extname(fileName))
  .replace(/[^a-z0-9_-]+/gi, "-")
  .replace(/^-+|-+$/g, "") || "roughcut";

async function receiveUpload(request, workingDirectory) {
  const encodedName = String(request.headers["x-file-name"] ?? "source-video");
  const fileName = path.basename(decodeURIComponent(encodedName)) || "source-video";
  const inputPath = path.join(workingDirectory, fileName);
  let received = 0;
  request.on("data", (chunk) => {
    received += chunk.length;
    if (received > MAX_UPLOAD_BYTES) request.destroy(new Error("Upload exceeded 2 GB"));
  });
  await pipeline(request, createWriteStream(inputPath));
  return { fileName, inputPath };
}

export function buildRenderFilter(keepRanges, videoOffset = 0) {
  if (!keepRanges.length) throw new Error("At least one source range is required for rendering.");
  const count = keepRanges.length;
  const videoSources = Array.from({ length: count }, (_, index) => `[vsrc${index}]`).join("");
  const audioSources = Array.from({ length: count }, (_, index) => `[asrc${index}]`).join("");
  const filters = count === 1
    ? ["[0:v]setpts=PTS-STARTPTS[vsrc0]", "[1:a]asetpts=PTS-STARTPTS[asrc0]"]
    : [
        `[0:v]setpts=PTS-STARTPTS,split=${count}${videoSources}`,
        `[1:a]asetpts=PTS-STARTPTS,asplit=${count}${audioSources}`,
      ];
  keepRanges.forEach((range, index) => {
    filters.push(
      `[vsrc${index}]trim=start=${(range.start + videoOffset).toFixed(6)}:end=${(range.end + videoOffset).toFixed(6)},setpts=PTS-STARTPTS[v${index}]`,
      `[asrc${index}]atrim=start=${range.start.toFixed(6)}:end=${range.end.toFixed(6)},asetpts=PTS-STARTPTS[a${index}]`,
    );
  });
  const inputs = keepRanges.map((_range, index) => `[v${index}][a${index}]`).join("");
  filters.push(`${inputs}concat=n=${count}:v=1:a=1[vout][aout]`);
  return filters.join(";\n");
}

export async function measureSourceAvOffset(inputPath) {
  try {
    const { stderr } = await runCapture(ffmpegExecutable(), [
      "-hide_banner", "-copyts", "-i", inputPath,
      "-filter_complex", "[0:v:0]showinfo[v];[0:a:0]ashowinfo[a]",
      "-map", "[v]", "-map", "[a]", "-frames:v", "1", "-frames:a", "1", "-f", "null", "-",
    ]);
    const videoStart = Number(stderr.match(/showinfo[^\n]*pts_time:\s*(-?[\d.]+)/)?.[1]);
    const audioStart = Number(stderr.match(/ashowinfo[^\n]*pts_time:\s*(-?[\d.]+)/)?.[1]);
    return Number.isFinite(videoStart) && Number.isFinite(audioStart)
      ? Math.max(0, audioStart - videoStart)
      : 0;
  } catch {
    return 0;
  }
}

export async function renderVideo(inputPath, audioPath, keepRanges, outputPath, workingDirectory) {
  const videoOffset = await measureSourceAvOffset(inputPath);
  const filterPath = path.join(workingDirectory, `render-${randomUUID()}.ffmpeg`);
  await writeFile(filterPath, buildRenderFilter(keepRanges, videoOffset));
  await run(ffmpegExecutable(), [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", inputPath, "-i", audioPath,
    "-filter_complex_script", filterPath,
    "-map", "[vout]", "-map", "[aout]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", outputPath,
  ], { env: process.env });
}

export async function measureMediaDuration(inputPath) {
  try {
    const { stderr } = await runCapture(ffmpegExecutable(), ["-hide_banner", "-i", inputPath]);
    return parseFfmpegDuration(stderr);
  } catch (error) {
    return parseFfmpegDuration(error instanceof Error ? error.message : "");
  }
}

const frameScaleFilter = `scale='min(${FRAME_MAX_WIDTH},iw)':-2`;

export async function extractInspirationFrames(
  inputPath,
  workingDirectory,
  count = DEFAULT_FRAME_COUNT,
  { image = isImageUpload(inputPath) } = {},
) {
  const framePath = (index) => path.join(
    workingDirectory,
    `inspiration-frame-${String(index + 1).padStart(2, "0")}.jpg`,
  );
  const readFrame = async (timestamp, index) => ({
    timestamp,
    base64: (await readFile(framePath(index))).toString("base64"),
    mimeType: "image/jpeg",
  });

  if (image) {
    await run(ffmpegExecutable(), [
      "-hide_banner", "-loglevel", "error", "-y", "-i", inputPath,
      "-frames:v", "1", "-vf", frameScaleFilter, "-q:v", "4", framePath(0),
    ]);
    return [await readFrame(0, 0)];
  }

  const duration = await measureMediaDuration(inputPath);
  const timestamps = frameTimestamps(duration ?? 0, count);
  const frames = [];
  for (const [index, timestamp] of timestamps.entries()) {
    await run(ffmpegExecutable(), [
      "-hide_banner", "-loglevel", "error", "-y",
      "-ss", timestamp.toFixed(3), "-i", inputPath,
      "-frames:v", "1", "-vf", frameScaleFilter, "-q:v", "4", framePath(index),
    ]);
    frames.push(await readFrame(timestamp, index));
  }
  return frames;
}

export async function extractAudio(inputPath, outputPath) {
  await run(ffmpegExecutable(), [
    "-hide_banner", "-loglevel", "error", "-y", "-i", inputPath,
    "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", outputPath,
  ]);
}

export async function transcribeFile(inputPath, workingDirectory) {
  const audioPath = path.join(workingDirectory, "audio.wav");
  await extractAudio(inputPath, audioPath);
  return transcribeWav(audioPath);
}

export function createTranscriptionServer({ transcribe = transcribeFile } = {}) {
  return createServer(async (request, response) => {
    const origin = allowedOrigin(request);
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "access-control-allow-origin": origin,
        "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
        "access-control-allow-headers": "content-type, x-file-name, x-roughcut-brief",
        "access-control-allow-private-network": "true",
        "access-control-max-age": "86400",
      });
      response.end();
      return;
    }
    if (request.method === "GET" && request.url === "/health") {
      json(response, 200, { status: "ready", rendering: true, platform: process.platform }, origin);
      return;
    }
    if (request.method === "DELETE" && request.url?.startsWith("/media/")) {
      const mediaId = request.url.slice("/media/".length);
      const media = preparedMedia.get(mediaId);
      if (media) {
        preparedMedia.delete(mediaId);
        await rm(media.workingDirectory, { recursive: true, force: true });
      }
      json(response, 200, { removed: Boolean(media) }, origin);
      return;
    }
    if (request.method === "POST" && request.url === "/inspiration") {
      let workingDirectory;
      try {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
          json(response, 503, {
            error: "Set OPENAI_API_KEY for the local companion service to analyze inspiration videos.",
          }, origin);
          return;
        }
        const brief = decodeURIComponent(String(request.headers["x-roughcut-brief"] ?? "")).trim();
        if (!brief) {
          json(response, 400, { error: "Paste the client brief before analyzing the inspiration." }, origin);
          return;
        }
        workingDirectory = await mkdtemp(path.join(tmpdir(), "roughcut-inspiration-"));
        const { fileName, inputPath } = await receiveUpload(request, workingDirectory);
        const frames = await extractInspirationFrames(inputPath, workingDirectory, DEFAULT_FRAME_COUNT, {
          image: isImageUpload(fileName, String(request.headers["content-type"] ?? "")),
        });
        const model = process.env.ROUGHCUT_FORMAT_MODEL ?? DEFAULT_FORMAT_MODEL;
        const formatSpec = await requestFormatAnalysis(
          buildFormatAnalysisRequest({ brief, frames, model }),
          { apiKey },
        );
        json(response, 200, {
          format_spec: formatSpec,
          frames_analyzed: frames.length,
          model,
          source: fileName,
        }, origin);
        return;
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Unknown inspiration analysis error";
        json(response, 500, { error: detail }, origin);
        return;
      } finally {
        if (workingDirectory) await rm(workingDirectory, { recursive: true, force: true });
      }
    }
    if (request.method === "POST" && (request.url === "/render" || request.url === "/segments")) {
      let workingDirectory;
      try {
        const payload = await readJsonBody(request);
        const media = preparedMedia.get(String(payload.media_id ?? ""));
        if (!media) {
          json(response, 404, { error: "Source media expired. Import the video again." }, origin);
          return;
        }
        const ranges = normalizeKeepRanges(payload.keep_ranges, Number(payload.duration) || Number.POSITIVE_INFINITY);
        const baseName = safeBaseName(media.fileName);
        workingDirectory = await mkdtemp(path.join(tmpdir(), "roughcut-render-"));
        if (request.url === "/render") {
          const outputPath = path.join(workingDirectory, `${baseName}-preview.mp4`);
          await renderVideo(media.inputPath, media.audioPath, ranges, outputPath, workingDirectory);
          const validationAudioPath = path.join(workingDirectory, "rendered-audio.wav");
          await extractAudio(outputPath, validationAudioPath);
          const renderedAudio = await readPcmWav(validationAudioPath);
          const renderValidation = analyzeSilence(renderedAudio.samples, renderedAudio.sampleRate);
          binary(
            response,
            200,
            await readFile(outputPath),
            origin,
            "video/mp4",
            `${baseName}-roughcut.mp4`,
            {
              "x-roughcut-max-silence-ms": String(Math.round(renderValidation.maximum_measured_silence * 1000)),
              "x-roughcut-long-silence-count": String(renderValidation.long_silences.length),
            },
          );
          return;
        }

        const packageDirectory = path.join(workingDirectory, `${baseName}-segments`);
        await writePackageGuides(packageDirectory, media.fileName, ranges, payload.format ?? null);
        for (let index = 0; index < ranges.length; index += 1) {
          const range = ranges[index];
          const outputPath = path.join(packageDirectory, segmentFileName(index, range));
          await renderVideo(media.inputPath, media.audioPath, [range], outputPath, workingDirectory);
        }
        const archivePath = path.join(workingDirectory, `${baseName}-segments.zip`);
        await new Promise((resolve, reject) => {
          const output = createWriteStream(archivePath);
          const archive = archiver("zip", { zlib: { level: 9 } });
          output.on("close", resolve);
          output.on("error", reject);
          archive.on("error", reject);
          archive.pipe(output);
          archive.directory(packageDirectory, path.basename(packageDirectory));
          void archive.finalize();
        });
        binary(response, 200, await readFile(archivePath), origin, "application/zip", `${baseName}-segments.zip`);
        return;
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Unknown render error";
        json(response, 500, { error: detail }, origin);
        return;
      } finally {
        if (workingDirectory) await rm(workingDirectory, { recursive: true, force: true });
      }
    }
    const isTranscription = request.method === "POST" && ["/transcribe", "/prepare"].includes(request.url);
    if (!isTranscription) {
      json(response, 404, { error: "Not found" }, origin);
      return;
    }

    const contentLength = Number(request.headers["content-length"] ?? 0);
    if (contentLength > MAX_UPLOAD_BYTES) {
      json(response, 413, { error: "Video is larger than the 2 GB local limit." }, origin);
      return;
    }

    const workingDirectory = await mkdtemp(path.join(tmpdir(), "roughcut-transcribe-"));
    let keepWorkingDirectory = false;
    try {
      const { fileName, inputPath } = await receiveUpload(request, workingDirectory);
      const result = await transcribe(inputPath, workingDirectory);
      if (request.url === "/prepare") {
        const mediaId = randomUUID();
        preparedMedia.set(mediaId, {
          fileName,
          inputPath,
          audioPath: path.join(workingDirectory, "audio.wav"),
          workingDirectory,
        });
        keepWorkingDirectory = true;
        json(response, 200, { ...result, media_id: mediaId }, origin);
      } else {
        json(response, 200, result, origin);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown transcription error";
      json(response, 500, {
        error: detail,
      }, origin);
    } finally {
      if (!keepWorkingDirectory) await rm(workingDirectory, { recursive: true, force: true });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createTranscriptionServer().listen(PORT, "127.0.0.1", () => {
    console.log(`Roughcut transcriber ready at http://127.0.0.1:${PORT}`);
  });
}
