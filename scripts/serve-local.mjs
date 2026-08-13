import { spawn } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const mode = process.argv[2] === "start" ? "start" : "dev";
const vinext = path.join(root, "node_modules", ".bin", "vinext");
const children = [
  spawn(process.execPath, [path.join(root, "transcription", "server.mjs")], { cwd: root, stdio: "inherit", env: process.env }),
  spawn(vinext, [mode], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      WRANGLER_LOG_PATH: ".wrangler/wrangler.log",
    },
  }),
];

let closing = false;
const closeAll = (signal = "SIGTERM") => {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill(signal);
};

for (const child of children) {
  child.on("exit", (code, signal) => {
    if (!closing) {
      closeAll();
      process.exitCode = signal ? 1 : (code ?? 1);
    }
  });
}
process.on("SIGINT", () => closeAll("SIGINT"));
process.on("SIGTERM", () => closeAll("SIGTERM"));
