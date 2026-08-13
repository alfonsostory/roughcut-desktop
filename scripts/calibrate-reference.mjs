import { readFile } from "node:fs/promises";
import { calibrateFromReferenceEdit } from "../app/lib/calibration/reference.mjs";
import { normalizeTranscriptPayload } from "../app/lib/transcription/normalize.mjs";

const [sourcePath, editedPath] = process.argv.slice(2);
if (!sourcePath || !editedPath) {
  console.error("Usage: node scripts/calibrate-reference.mjs SOURCE_TRANSCRIPT EDITED_TRANSCRIPT");
  process.exit(1);
}

const [source, edited] = await Promise.all([
  readFile(sourcePath, "utf8").then(JSON.parse).then(normalizeTranscriptPayload),
  readFile(editedPath, "utf8").then(JSON.parse).then(normalizeTranscriptPayload),
]);

console.log(JSON.stringify(calibrateFromReferenceEdit(source, edited), null, 2));
