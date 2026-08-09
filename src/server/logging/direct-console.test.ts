import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ALLOWED_DIRECT_CONSOLE_FILES = new Set(["src/server/db/migrate.ts"]);

async function collectTypeScriptFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory())
      files.push(...(await collectTypeScriptFiles(path)));
    else if (
      entry.isFile() &&
      /\.(?:ts|tsx)$/u.test(entry.name) &&
      !/\.test\.(?:ts|tsx)$/u.test(entry.name)
    )
      files.push(path);
  }
  return files;
}

describe("server logging boundary", () => {
  it("routes production TypeScript console output through the logger", async () => {
    const root = process.cwd();
    const directConsolePattern = /\bconsole\.(?:error|warn|info|log)\s*\(/u;
    const directConsoleFiles: string[] = [];
    for (const path of await collectTypeScriptFiles(resolve(root, "src"))) {
      if (directConsolePattern.test(await readFile(path, "utf8")))
        directConsoleFiles.push(relative(root, path));
    }
    expect(directConsoleFiles.sort()).toEqual(
      [...ALLOWED_DIRECT_CONSOLE_FILES].sort(),
    );
  });
});
