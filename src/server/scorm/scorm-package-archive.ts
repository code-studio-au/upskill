import "@tanstack/react-start/server-only";

import { posix } from "node:path";
import {
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
  type Entry,
} from "@zip.js/zip.js";
import { XMLParser } from "fast-xml-parser";
import { SyntaxValidator } from "fast-xml-validator";
import { SCORM_MAX_ARCHIVE_BYTES } from "#/features/scorm/scorm-package.schema";

export const SCORM_ARCHIVE_LIMITS = {
  archiveBytes: SCORM_MAX_ARCHIVE_BYTES,
  entries: 5_000,
  entryBytes: 64 * 1024 * 1024,
  expandedBytes: 1024 * 1024 * 1024,
  manifestBytes: 2 * 1024 * 1024,
  compressionRatio: 200,
} as const;

export type ScormValidationCode =
  | "archive_too_large"
  | "duplicate_path"
  | "encrypted_entry"
  | "entry_too_large"
  | "expanded_archive_too_large"
  | "invalid_manifest"
  | "invalid_zip"
  | "missing_launch_file"
  | "missing_manifest"
  | "too_many_entries"
  | "unsafe_compression_ratio"
  | "unsafe_entry_type"
  | "unsafe_path"
  | "unsupported_profile"
  | "unsupported_standard";

export class ScormPackageValidationError extends Error {
  constructor(
    readonly code: ScormValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "ScormPackageValidationError";
  }
}

export interface ScormPackageManifest {
  identifier: string;
  organizationIdentifier: string;
  resourceIdentifier: string;
  title: string;
  standard: "scorm-1.2";
  launchPath: string;
  fileCount: number;
  expandedBytes: number;
}

interface ScormArchiveFile {
  bytes: Uint8Array;
  contentType: string;
  path: string;
}

type ArchiveFileHandler = (file: ScormArchiveFile) => Promise<void>;
type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function list(value: unknown): unknown[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

export function validateArchiveEntryPath(value: string): string {
  if (
    value.length === 0 ||
    value.length > 1_024 ||
    value.includes("\0") ||
    value.includes("\\") ||
    value.startsWith("/") ||
    /^[A-Za-z]:/.test(value)
  )
    throw new ScormPackageValidationError(
      "unsafe_path",
      `Unsafe archive path: ${value}`,
    );
  const withoutDirectorySuffix = value.endsWith("/")
    ? value.slice(0, -1)
    : value;
  if (
    !withoutDirectorySuffix ||
    withoutDirectorySuffix
      .split("/")
      .some((part) => !part || part === "." || part === "..") ||
    posix.normalize(withoutDirectorySuffix) !== withoutDirectorySuffix
  )
    throw new ScormPackageValidationError(
      "unsafe_path",
      `Unsafe archive path: ${value}`,
    );
  return withoutDirectorySuffix;
}

function decodedManifestPath(value: string): string {
  if (value.includes("?") || value.includes("#"))
    throw new ScormPackageValidationError(
      "unsafe_path",
      `Manifest path cannot contain a query or fragment: ${value}`,
    );
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new ScormPackageValidationError(
      "unsafe_path",
      `Manifest path is not valid URI encoding: ${value}`,
    );
  }
  return validateArchiveEntryPath(decoded);
}

function isUnsafeUnixEntry(entry: Entry): boolean {
  if (entry.unixMode === undefined) return false;
  const type = entry.unixMode & 0o170000;
  return type !== 0 && type !== 0o100000 && type !== 0o040000;
}

function contentTypeFor(path: string): string {
  const extension = posix.extname(path).toLowerCase();
  return (
    {
      ".css": "text/css; charset=utf-8",
      ".gif": "image/gif",
      ".htm": "text/html; charset=utf-8",
      ".html": "text/html; charset=utf-8",
      ".jpeg": "image/jpeg",
      ".jpg": "image/jpeg",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".m4a": "audio/mp4",
      ".mp3": "audio/mpeg",
      ".mp4": "video/mp4",
      ".oga": "audio/ogg",
      ".ogg": "audio/ogg",
      ".ogv": "video/ogg",
      ".pdf": "application/pdf",
      ".png": "image/png",
      ".svg": "image/svg+xml",
      ".ttf": "font/ttf",
      ".txt": "text/plain; charset=utf-8",
      ".woff": "font/woff",
      ".woff2": "font/woff2",
      ".xml": "application/xml; charset=utf-8",
      ".vtt": "text/vtt; charset=utf-8",
      ".webm": "video/webm",
      ".zip": "application/zip",
    }[extension] ?? "application/octet-stream"
  );
}

async function readEntryBytes(
  entry: Entry & { directory: false },
  path: string,
): Promise<Uint8Array> {
  try {
    return await entry.getData(new Uint8ArrayWriter(), {
      useWebWorkers: false,
    });
  } catch (error) {
    throw new ScormPackageValidationError(
      "invalid_zip",
      `Unable to extract ${path}: ${error instanceof Error ? error.message : "invalid ZIP data"}`,
    );
  }
}

async function extractFilesWithBoundedMemory(
  files: ReadonlyArray<{
    entry: Entry & { directory: false };
    path: string;
  }>,
  manifestBytes: Uint8Array,
  onFile: ArchiveFileHandler,
  index = 0,
): Promise<void> {
  const file = files[index];
  if (!file) return;
  const bytes =
    file.path === "imsmanifest.xml"
      ? manifestBytes
      : await readEntryBytes(file.entry, file.path);
  await onFile({
    path: file.path,
    bytes,
    contentType: contentTypeFor(file.path),
  });
  await extractFilesWithBoundedMemory(files, manifestBytes, onFile, index + 1);
}

function parseManifest(
  xml: string,
  paths: ReadonlySet<string>,
  fileCount: number,
  expandedBytes: number,
): ScormPackageManifest {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new ScormPackageValidationError(
      "invalid_manifest",
      "SCORM manifests cannot declare document types or entities",
    );
  let parsed: JsonRecord | undefined;
  try {
    SyntaxValidator.validate(xml);
    parsed = record(
      new XMLParser({
        ignoreAttributes: false,
        parseAttributeValue: false,
        parseTagValue: false,
        processEntities: true,
        trimValues: true,
      }).parse(xml),
    );
  } catch {
    throw new ScormPackageValidationError(
      "invalid_manifest",
      "imsmanifest.xml is not well-formed XML",
    );
  }
  const manifest = record(parsed?.manifest);
  const identifier = nonEmptyString(manifest?.["@_identifier"]);
  const metadata = record(manifest?.metadata);
  const schema = nonEmptyString(metadata?.schema)?.toLowerCase();
  const schemaVersion = nonEmptyString(metadata?.schemaversion)?.toLowerCase();
  if (schema !== "adl scorm" || schemaVersion !== "1.2")
    throw new ScormPackageValidationError(
      "unsupported_standard",
      "Only ADL SCORM 1.2 packages are supported",
    );

  const organizations = record(manifest?.organizations);
  const defaultOrganization = nonEmptyString(organizations?.["@_default"]);
  const organization = list(organizations?.organization)
    .map(record)
    .find(
      (candidate) =>
        candidate &&
        (!defaultOrganization ||
          candidate["@_identifier"] === defaultOrganization),
    );
  const organizationIdentifier = nonEmptyString(organization?.["@_identifier"]);
  const items = list(organization?.item)
    .map(record)
    .filter((candidate): candidate is JsonRecord => candidate !== undefined);
  if (items.length !== 1)
    throw new ScormPackageValidationError(
      "unsupported_profile",
      "The supported Rise 360 profile must contain exactly one SCO item",
    );
  const item = items[0];
  if (!item)
    throw new ScormPackageValidationError(
      "unsupported_profile",
      "The supported Rise 360 profile must contain exactly one SCO item",
    );
  const resourceIdentifier = nonEmptyString(item["@_identifierref"]);
  const title = nonEmptyString(item.title);
  const resources = list(record(manifest?.resources)?.resource)
    .map(record)
    .filter((candidate): candidate is JsonRecord => candidate !== undefined);
  const resource = resources.find(
    (candidate) => candidate["@_identifier"] === resourceIdentifier,
  );
  const scormType = nonEmptyString(resource?.["@_adlcp:scormtype"]);
  const launchHref = nonEmptyString(resource?.["@_href"]);
  if (
    !identifier ||
    !organizationIdentifier ||
    !resourceIdentifier ||
    !title ||
    title.length > 200 ||
    resources.length !== 1 ||
    scormType?.toLowerCase() !== "sco" ||
    !launchHref
  )
    throw new ScormPackageValidationError(
      "unsupported_profile",
      "The package does not match the supported single-SCO Rise 360 profile",
    );
  const launchPath = decodedManifestPath(launchHref);
  if (!paths.has(launchPath))
    throw new ScormPackageValidationError(
      "missing_launch_file",
      `The manifest launch file does not exist: ${launchPath}`,
    );
  for (const file of list(resource?.file)) {
    const href = nonEmptyString(record(file)?.["@_href"]);
    if (!href) continue;
    const path = decodedManifestPath(href);
    if (!paths.has(path))
      throw new ScormPackageValidationError(
        "invalid_manifest",
        `A manifest resource file does not exist: ${path}`,
      );
  }
  return {
    identifier,
    organizationIdentifier,
    resourceIdentifier,
    title,
    standard: "scorm-1.2",
    launchPath,
    fileCount,
    expandedBytes,
  };
}

export async function processScormArchive(
  archive: Uint8Array,
  onFile?: ArchiveFileHandler,
): Promise<ScormPackageManifest> {
  if (
    archive.byteLength === 0 ||
    archive.byteLength > SCORM_ARCHIVE_LIMITS.archiveBytes
  )
    throw new ScormPackageValidationError(
      "archive_too_large",
      "SCORM ZIP exceeds the compressed archive limit",
    );
  const reader = new ZipReader(new Uint8ArrayReader(archive), {
    useWebWorkers: false,
  });
  try {
    let entries: Entry[];
    try {
      entries = await reader.getEntries();
    } catch (error) {
      throw new ScormPackageValidationError(
        "invalid_zip",
        error instanceof Error ? error.message : "Unable to read ZIP directory",
      );
    }
    if (entries.length > SCORM_ARCHIVE_LIMITS.entries)
      throw new ScormPackageValidationError(
        "too_many_entries",
        "SCORM ZIP contains too many entries",
      );
    const paths = new Set<string>();
    const files: Array<{ entry: Entry & { directory: false }; path: string }> =
      [];
    let expandedBytes = 0;
    for (const entry of entries) {
      const path = validateArchiveEntryPath(entry.filename);
      if (paths.has(path))
        throw new ScormPackageValidationError(
          "duplicate_path",
          `SCORM ZIP contains a duplicate path: ${path}`,
        );
      paths.add(path);
      if (entry.encrypted)
        throw new ScormPackageValidationError(
          "encrypted_entry",
          `Encrypted ZIP entries are unsupported: ${path}`,
        );
      if (isUnsafeUnixEntry(entry))
        throw new ScormPackageValidationError(
          "unsafe_entry_type",
          `Links and special ZIP entries are unsupported: ${path}`,
        );
      if (entry.directory) continue;
      if (entry.uncompressedSize > SCORM_ARCHIVE_LIMITS.entryBytes)
        throw new ScormPackageValidationError(
          "entry_too_large",
          `ZIP entry exceeds the individual file limit: ${path}`,
        );
      if (
        entry.uncompressedSize > 0 &&
        entry.uncompressedSize / Math.max(entry.compressedSize, 1) >
          SCORM_ARCHIVE_LIMITS.compressionRatio
      )
        throw new ScormPackageValidationError(
          "unsafe_compression_ratio",
          `ZIP entry has an unsafe compression ratio: ${path}`,
        );
      expandedBytes += entry.uncompressedSize;
      if (expandedBytes > SCORM_ARCHIVE_LIMITS.expandedBytes)
        throw new ScormPackageValidationError(
          "expanded_archive_too_large",
          "SCORM ZIP exceeds the expanded archive limit",
        );
      files.push({ entry, path });
    }
    const manifestFile = files.find(({ path }) => path === "imsmanifest.xml");
    if (!manifestFile)
      throw new ScormPackageValidationError(
        "missing_manifest",
        "SCORM ZIP must contain imsmanifest.xml at its root",
      );
    if (
      manifestFile.entry.uncompressedSize > SCORM_ARCHIVE_LIMITS.manifestBytes
    )
      throw new ScormPackageValidationError(
        "invalid_manifest",
        "imsmanifest.xml exceeds the manifest size limit",
      );
    const manifestBytes = await readEntryBytes(
      manifestFile.entry,
      manifestFile.path,
    );
    let manifestXml: string;
    try {
      manifestXml = new TextDecoder("utf-8", { fatal: true }).decode(
        manifestBytes,
      );
    } catch {
      throw new ScormPackageValidationError(
        "invalid_manifest",
        "imsmanifest.xml must be valid UTF-8",
      );
    }
    const manifest = parseManifest(
      manifestXml,
      new Set(files.map(({ path }) => path)),
      files.length,
      expandedBytes,
    );
    if (onFile)
      await extractFilesWithBoundedMemory(files, manifestBytes, onFile);
    return manifest;
  } finally {
    await reader.close();
  }
}
