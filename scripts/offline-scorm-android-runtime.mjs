import {
  createPrivateKey,
  generateKeyPairSync,
  randomBytes,
} from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function decodeCanonicalBase64Url(value) {
  if (typeof value !== "string") throw new Error("Expected base64url text");
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value)
    throw new Error("Expected canonical base64url text");
  return decoded;
}

function parseRuntime(value) {
  const parsed = JSON.parse(value);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    parsed.schemaVersion !== 1 ||
    typeof parsed.signingPrivateKeyPkcs8 !== "string" ||
    typeof parsed.packageSiteOriginKey !== "string"
  )
    throw new Error("Local Offline SCORM Android runtime file is invalid");
  const privateKey = decodeCanonicalBase64Url(parsed.signingPrivateKeyPkcs8);
  createPrivateKey({ key: privateKey, format: "der", type: "pkcs8" });
  const originKey = decodeCanonicalBase64Url(parsed.packageSiteOriginKey);
  if (originKey.byteLength !== 32)
    throw new Error(
      "Local Offline SCORM package-site key must contain 256 bits",
    );
  return parsed;
}

function createRuntime() {
  const { privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  return {
    schemaVersion: 1,
    signingPrivateKeyPkcs8: privateKey
      .export({ format: "der", type: "pkcs8" })
      .toString("base64url"),
    packageSiteOriginKey: randomBytes(32).toString("base64url"),
  };
}

export async function loadOrCreateOfflineScormAndroidRuntime(
  runtimePath = ".local/offline-scorm-android-runtime.json",
) {
  try {
    return parseRuntime(await readFile(runtimePath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const runtime = createRuntime();
  await mkdir(path.dirname(runtimePath), { recursive: true, mode: 0o700 });
  try {
    await writeFile(runtimePath, `${JSON.stringify(runtime)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    return runtime;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    return parseRuntime(await readFile(runtimePath, "utf8"));
  }
}
