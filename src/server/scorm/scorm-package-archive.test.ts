import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { describe, expect, it } from "vitest";
import {
  processScormArchive,
  ScormPackageValidationError,
  validateArchiveEntryPath,
} from "./scorm-package-archive";

function manifest(options?: {
  launchPath?: string;
  schemaVersion?: string;
}): string {
  const launchPath = options?.launchPath ?? "scormdriver/indexAPI.html";
  const schemaVersion = options?.schemaVersion ?? "1.2";
  return `<?xml version="1.0"?>
<manifest identifier="fixture" xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2" xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
  <metadata><schema>ADL SCORM</schema><schemaversion>${schemaVersion}</schemaversion></metadata>
  <organizations default="rise"><organization identifier="rise"><title>Fixture</title><item identifier="item" identifierref="resource"><title>Fixture module</title></item></organization></organizations>
  <resources><resource identifier="resource" type="webcontent" adlcp:scormtype="sco" href="${launchPath}"><file href="${launchPath}" /></resource></resources>
</manifest>`;
}

async function archive(entries: Record<string, string>): Promise<Uint8Array> {
  const output = new Uint8ArrayWriter();
  const writer = new ZipWriter(output, { useWebWorkers: false });
  for (const [path, content] of Object.entries(entries))
    await writer.add(path, new TextReader(content), { useWebWorkers: false });
  await writer.close();
  return output.getData();
}

describe("SCORM package archive validation", () => {
  it("accepts and extracts the supported single-SCO SCORM 1.2 profile", async () => {
    const zip = await archive({
      "imsmanifest.xml": manifest(),
      "scormdriver/indexAPI.html": "<!doctype html><title>Fixture</title>",
      "scormcontent/app.js": "console.log('fixture')",
    });
    const extracted: string[] = [];
    const result = await processScormArchive(zip, (file) => {
      extracted.push(`${file.path}:${file.contentType}`);
      return Promise.resolve();
    });
    expect(result).toMatchObject({
      identifier: "fixture",
      title: "Fixture module",
      standard: "scorm-1.2",
      launchPath: "scormdriver/indexAPI.html",
      fileCount: 3,
    });
    expect(extracted).toEqual([
      "imsmanifest.xml:application/xml; charset=utf-8",
      "scormdriver/indexAPI.html:text/html; charset=utf-8",
      "scormcontent/app.js:text/javascript; charset=utf-8",
    ]);
  });

  it("rejects path traversal and platform-specific absolute paths", () => {
    for (const path of ["../secret", "safe/../secret", "/absolute", "C:/file"])
      expect(() => validateArchiveEntryPath(path)).toThrow(
        ScormPackageValidationError,
      );
    expect(validateArchiveEntryPath("scormcontent/index.html")).toBe(
      "scormcontent/index.html",
    );
  });

  it("rejects a manifest whose launch target is absent", async () => {
    const zip = await archive({ "imsmanifest.xml": manifest() });
    await expect(processScormArchive(zip)).rejects.toMatchObject({
      code: "missing_launch_file",
    });
  });

  it("rejects unsupported SCORM standards", async () => {
    const zip = await archive({
      "imsmanifest.xml": manifest({ schemaVersion: "2004 4th Edition" }),
      "scormdriver/indexAPI.html": "fixture",
    });
    await expect(processScormArchive(zip)).rejects.toMatchObject({
      code: "unsupported_standard",
    });
  });

  it("rejects manifests with document type declarations", async () => {
    const zip = await archive({
      "imsmanifest.xml": `<!DOCTYPE manifest [<!ENTITY x "unsafe">]>${manifest()}`,
      "scormdriver/indexAPI.html": "fixture",
    });
    await expect(processScormArchive(zip)).rejects.toMatchObject({
      code: "invalid_manifest",
    });
  });
});
