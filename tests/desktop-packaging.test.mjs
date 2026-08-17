import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { writeDesktopSmokeResult } from "../desktop/smoke-test.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Windows desktop packaging produces an NSIS installer rather than a ZIP", async () => {
  const packageJson = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  const workflow = await fs.readFile(path.join(root, ".github/workflows/desktop-build.yml"), "utf8");
  assert.deepEqual(packageJson.build.win.target, ["nsis"]);
  assert.match(packageJson.scripts["desktop:dist:win"], /--win nsis --x64/);
  assert.equal(packageJson.build.nsis.oneClick, false);
  assert.equal(packageJson.build.nsis.allowToChangeInstallationDirectory, true);
  assert.match(workflow, /pnpm desktop:test:win-installer/);
  assert.match(workflow, /release\/\*\.exe/);
  assert.doesNotMatch(workflow, /windows[^\n]*\.zip/i);
});

test("desktop smoke results are written for the Windows installer check", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "roughcut-smoke-"));
  const outputPath = path.join(directory, "nested", "result.json");
  const result = { packaged: true, platform: "win32", arch: "x64", mediaServiceReady: true };
  await writeDesktopSmokeResult(outputPath, result);
  assert.deepEqual(JSON.parse(await fs.readFile(outputPath, "utf8")), result);
});
