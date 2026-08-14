import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  }, { waitUntil() {}, passThroughOnException() {} });
}

test("server-renders the rough-cut review workspace", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>Roughcut — Talking-head edit review<\/title>/i);
  assert.match(html, /Review proposed cuts/);
  assert.match(html, /Word \+ audio-safe boundaries/);
  assert.match(html, /Export EDL/);
  assert.match(html, /Render cut preview/);
  assert.match(html, /Word transcript \+ audio waveform/);
  assert.match(html, /Click a word or the waveform to seek the source video/);
  assert.match(html, /Paragraph transcript/);
  assert.match(html, /After cuts/);
  assert.match(html, /Export \d+ segments/);
  assert.match(html, /Every proposed cut starts approved, including high-risk cuts/);
  assert.match(html, /High-risk cut approved by default/);
  assert.doesNotMatch(html, /Manual decision required|need review/i);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});
