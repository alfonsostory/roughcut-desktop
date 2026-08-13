import { createServer } from "node:http";
import { createWriteStream } from "node:fs";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pipeline } from "node:stream/promises";
import { normalizeKeepRanges, segmentFileName, writePackageGuides } from "./export-package.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
const PORT = Number(process.env.ROUGHCUT_TRANSCRIBER_PORT ?? 4317);
const preparedMedia = new Map();
let rendererBinaryPromise;

const json = (response, status, payload, origin) => {
  response.writeHead(status, {
    "access-control-allow-origin": origin,
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
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
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : "http://localhost:3000";
};

const commandExists = async (command) => {
  const paths = (process.env.PATH ?? "").split(path.delimiter);
  for (const directory of paths) {
    try {
      await access(path.join(directory, command));
      return true;
    } catch {
      // Try the next PATH entry.
    }
  }
  return false;
};

const run = (command, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-8000);
  });
  child.on("error", reject);
  child.on("exit", (code) => {
    if (code === 0) resolve();
    else reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
  });
});

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

async function renderVideo(inputPath, audioPath, keepRanges, outputPath, workingDirectory) {
  if (process.platform !== "darwin" || !await commandExists("swift")) {
    throw new Error("Rendered preview currently requires the local macOS companion.");
  }
  rendererBinaryPromise ??= (async () => {
    const binaryPath = path.join(ROOT, "work", "roughcut-renderer");
    await mkdir(path.dirname(binaryPath), { recursive: true });
    await run("swiftc", ["-O", path.join(ROOT, "transcription", "render.swift"), "-o", binaryPath], {
      cwd: ROOT,
      env: process.env,
    });
    return binaryPath;
  })();
  const rendererBinary = await rendererBinaryPromise;
  const edlPath = path.join(workingDirectory, `render-${randomUUID()}.json`);
  await writeFile(edlPath, `${JSON.stringify({ keepRanges })}\n`);
  await run(rendererBinary, [inputPath, audioPath, edlPath, outputPath], {
    cwd: ROOT,
    env: process.env,
  });
}

const pythonCommand = async () => {
  if (process.env.ROUGHCUT_PYTHON) return process.env.ROUGHCUT_PYTHON;
  const bundled = path.join(ROOT, "work", "whisper-env", "bin", "python");
  try {
    await access(bundled);
    return bundled;
  } catch {
    return "python3";
  }
};

export async function extractAudio(inputPath, outputPath) {
  if (await commandExists("ffmpeg")) {
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", inputPath, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", outputPath]);
    return;
  }
  if (process.platform === "darwin" && await commandExists("afconvert")) {
    await run("afconvert", [inputPath, outputPath, "-f", "WAVE", "-d", "LEI16@16000", "-c", "1"]);
    return;
  }
  throw new Error("Audio extraction requires ffmpeg, or afconvert on macOS.");
}

export async function transcribeFile(inputPath, workingDirectory) {
  const audioPath = path.join(workingDirectory, "audio.wav");
  const outputPath = path.join(workingDirectory, "transcript.json");
  await extractAudio(inputPath, audioPath);
  const python = await pythonCommand();
  await run(python, [path.join(ROOT, "transcription", "transcribe.py"), audioPath, outputPath], {
    cwd: ROOT,
    env: process.env,
  });
  return JSON.parse(await readFile(outputPath, "utf8"));
}

export function createTranscriptionServer({ transcribe = transcribeFile } = {}) {
  return createServer(async (request, response) => {
    const origin = allowedOrigin(request);
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "access-control-allow-origin": origin,
        "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
        "access-control-allow-headers": "content-type, x-file-name",
        "access-control-max-age": "86400",
      });
      response.end();
      return;
    }
    if (request.method === "GET" && request.url === "/health") {
      json(response, 200, { status: "ready", rendering: process.platform === "darwin" }, origin);
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
          const validationPath = path.join(workingDirectory, "render-validation.json");
          await extractAudio(outputPath, validationAudioPath);
          await run(await pythonCommand(), [
            path.join(ROOT, "transcription", "analyze_silence.py"),
            validationAudioPath,
            validationPath,
          ], { cwd: ROOT, env: process.env });
          const renderValidation = JSON.parse(await readFile(validationPath, "utf8"));
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
        await writePackageGuides(packageDirectory, media.fileName, ranges);
        for (let index = 0; index < ranges.length; index += 1) {
          const range = ranges[index];
          const outputPath = path.join(packageDirectory, segmentFileName(index, range));
          await renderVideo(media.inputPath, media.audioPath, [range], outputPath, workingDirectory);
        }
        const archivePath = path.join(workingDirectory, `${baseName}-segments.zip`);
        await run("zip", ["-r", "-X", archivePath, path.basename(packageDirectory)], {
          cwd: workingDirectory,
          env: process.env,
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
      const setupMissing = /mlx_whisper|No module named|python3.*ENOENT/i.test(detail);
      json(response, 500, {
        error: setupMissing
          ? "Local transcription is not installed. Run pnpm run transcribe:setup once."
          : detail,
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
