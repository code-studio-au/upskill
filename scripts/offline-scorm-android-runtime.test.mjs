import { createPrivateKey } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadOrCreateOfflineScormAndroidRuntime } from "./offline-scorm-android-runtime.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function runtimePath() {
  const directory = await mkdtemp(path.join(tmpdir(), "upskill-android-"));
  temporaryDirectories.push(directory);
  return path.join(directory, "nested", "runtime.json");
}

describe("local Offline SCORM Android runtime", () => {
  it("persists stable private keys with owner-only permissions", async () => {
    const target = await runtimePath();
    const first = await loadOrCreateOfflineScormAndroidRuntime(target);
    const second = await loadOrCreateOfflineScormAndroidRuntime(target);

    expect(second).toEqual(first);
    expect(Buffer.from(first.packageSiteOriginKey, "base64url")).toHaveLength(
      32,
    );
    expect(() =>
      createPrivateKey({
        key: Buffer.from(first.signingPrivateKeyPkcs8, "base64url"),
        format: "der",
        type: "pkcs8",
      }),
    ).not.toThrow();
    expect((await stat(target)).mode & 0o077).toBe(0);
    expect(JSON.parse(await readFile(target, "utf8"))).toEqual(first);
  });

  it("rejects an invalid existing runtime instead of replacing it", async () => {
    const target = await runtimePath();
    await loadOrCreateOfflineScormAndroidRuntime(target);
    await writeFile(target, '{"schemaVersion":1}\n', "utf8");

    await expect(
      loadOrCreateOfflineScormAndroidRuntime(target),
    ).rejects.toThrow("runtime file is invalid");
    await expect(readFile(target, "utf8")).resolves.toBe(
      '{"schemaVersion":1}\n',
    );
  });
});
