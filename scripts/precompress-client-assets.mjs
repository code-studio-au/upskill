import { constants, brotliCompressSync, gzipSync } from "node:zlib";
import { readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const clientDirectory = path.resolve("dist/client");
const compressibleExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".svg",
  ".txt",
  ".webmanifest",
  ".xml",
]);

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) => {
        const target = path.join(directory, entry.name);
        return entry.isDirectory() ? files(target) : [target];
      }),
    )
  ).flat();
}

async function removeIfPresent(target) {
  try {
    await unlink(target);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function writeSmallerSidecar(target, suffix, compressed, sourceBytes) {
  const sidecar = `${target}${suffix}`;
  if (compressed.byteLength >= sourceBytes) {
    await removeIfPresent(sidecar);
    return 0;
  }
  await writeFile(sidecar, compressed, { mode: 0o644 });
  return compressed.byteLength;
}

const details = await stat(clientDirectory);
if (!details.isDirectory())
  throw new Error("Build output dist/client is missing");

let sourceBytes = 0;
let brotliBytes = 0;
let gzipBytes = 0;
let compressedFiles = 0;
for (const target of await files(clientDirectory)) {
  if (
    target.endsWith(".br") ||
    target.endsWith(".gz") ||
    !compressibleExtensions.has(path.extname(target).toLowerCase())
  )
    continue;
  const source = await readFile(target);
  const brotli = brotliCompressSync(source, {
    params: {
      [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
      [constants.BROTLI_PARAM_QUALITY]: 11,
    },
  });
  const gzip = gzipSync(source, { level: 9 });
  const writtenBrotli = await writeSmallerSidecar(
    target,
    ".br",
    brotli,
    source.byteLength,
  );
  const writtenGzip = await writeSmallerSidecar(
    target,
    ".gz",
    gzip,
    source.byteLength,
  );
  if (writtenBrotli > 0 || writtenGzip > 0) compressedFiles += 1;
  sourceBytes += source.byteLength;
  brotliBytes += writtenBrotli || source.byteLength;
  gzipBytes += writtenGzip || source.byteLength;
}

console.log(
  `Precompressed ${String(compressedFiles)} client assets: ${String(sourceBytes)} source bytes, ${String(brotliBytes)} Brotli bytes, ${String(gzipBytes)} gzip bytes`,
);
