import assert from "node:assert/strict";
import test from "node:test";
import {
  createManualUpdateChecker,
  isNewerVersion,
  parseVersion,
  releasesPageUrl,
  selectLatestRelease,
} from "../desktop/updates.mjs";

const jsonResponse = (payload) => ({ ok: true, status: 200, json: async () => payload });

test("release tags are parsed with or without a prefix", () => {
  assert.deepEqual(parseVersion("v0.1.3"), { major: 0, minor: 1, patch: 3, prerelease: "" });
  assert.deepEqual(parseVersion("desktop-v1.2.10"), { major: 1, minor: 2, patch: 10, prerelease: "" });
  assert.equal(parseVersion("not-a-release"), undefined);
});

test("version comparison orders patch, minor, and major releases", () => {
  assert.equal(isNewerVersion("v0.1.3", "0.1.2"), true);
  assert.equal(isNewerVersion("v0.2.0", "0.1.9"), true);
  assert.equal(isNewerVersion("v1.0.0", "0.9.9"), true);
  assert.equal(isNewerVersion("v0.1.2", "0.1.2"), false);
  assert.equal(isNewerVersion("v0.1.1", "0.1.2"), false);
  // 0.1.10 must beat 0.1.9 rather than comparing as text.
  assert.equal(isNewerVersion("v0.1.10", "0.1.9"), true);
});

test("a finished release supersedes its own prerelease", () => {
  assert.equal(isNewerVersion("v0.1.3", "0.1.3-beta.1"), true);
  assert.equal(isNewerVersion("v0.1.3-beta.1", "0.1.3"), false);
});

test("draft and prerelease entries are never offered as the latest release", () => {
  const latest = selectLatestRelease([
    { tag_name: "v0.1.4", draft: true },
    { tag_name: "v0.1.5", prerelease: true },
    { tag_name: "v0.1.3" },
    { tag_name: "v0.1.2" },
  ]);
  assert.equal(latest.tag_name, "v0.1.3");
});

test("macOS is offered the download page when a newer release exists", async () => {
  const opened = [];
  const prompts = [];
  const check = createManualUpdateChecker({
    repository: "example/roughcut",
    currentVersion: "0.1.2",
    fetchImpl: async () => jsonResponse({ tag_name: "v0.1.3" }),
    askToDownload: async (details) => { prompts.push(details); return true; },
    openExternal: async (url) => { opened.push(url); },
  });

  assert.deepEqual(await check(), { status: "download_opened", version: "v0.1.3" });
  assert.deepEqual(prompts, [{ version: "0.1.3", currentVersion: "0.1.2" }]);
  assert.deepEqual(opened, [releasesPageUrl("example/roughcut")]);
});

test("declining the macOS update never opens a browser", async () => {
  const opened = [];
  const check = createManualUpdateChecker({
    repository: "example/roughcut",
    currentVersion: "0.1.2",
    fetchImpl: async () => jsonResponse({ tag_name: "v0.1.3" }),
    askToDownload: async () => false,
    openExternal: async (url) => { opened.push(url); },
  });

  assert.equal((await check()).status, "declined");
  assert.deepEqual(opened, []);
});

test("an up-to-date macOS app is never interrupted", async () => {
  let asked = false;
  const check = createManualUpdateChecker({
    repository: "example/roughcut",
    currentVersion: "0.1.3",
    fetchImpl: async () => jsonResponse({ tag_name: "v0.1.3" }),
    askToDownload: async () => { asked = true; return true; },
    openExternal: async () => {},
  });

  assert.deepEqual(await check(), { status: "up_to_date" });
  assert.equal(asked, false);
});

test("an unreachable or failing release feed never blocks startup", async () => {
  const failing = createManualUpdateChecker({
    repository: "example/roughcut",
    currentVersion: "0.1.2",
    fetchImpl: async () => { throw new Error("offline"); },
    askToDownload: async () => true,
    openExternal: async () => {},
  });
  assert.deepEqual(await failing(), { status: "check_failed" });

  const notFound = createManualUpdateChecker({
    repository: "example/roughcut",
    currentVersion: "0.1.2",
    fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) }),
    askToDownload: async () => true,
    openExternal: async () => {},
  });
  assert.deepEqual(await notFound(), { status: "check_failed" });
});
