import fs from "node:fs/promises";
import path from "node:path";

export async function writeDesktopSmokeResult(outputPath, result) {
  if (!outputPath) throw new Error("A smoke-test output path is required");
  const resolvedPath = path.resolve(outputPath);
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
  await fs.writeFile(resolvedPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return resolvedPath;
}
