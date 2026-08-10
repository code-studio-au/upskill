import { describe, expect, it } from "vitest";
import {
  appendVary,
  isCompressibleContentType,
  selectContentEncoding,
} from "./http-compression.mjs";

describe("HTTP content encoding", () => {
  it("prefers Brotli for secure static responses and keeps gzip fallback", () => {
    expect(
      selectContentEncoding("gzip, br", {
        brotliAvailable: true,
        gzipAvailable: true,
        secure: true,
      }),
    ).toBe("br");
    expect(
      selectContentEncoding("gzip, br", {
        brotliAvailable: true,
        gzipAvailable: true,
        secure: false,
      }),
    ).toBe("gzip");
  });

  it("honors quality exclusions and wildcard support", () => {
    expect(
      selectContentEncoding("br;q=0, gzip;q=0.7", {
        brotliAvailable: true,
        gzipAvailable: true,
        secure: true,
      }),
    ).toBe("gzip");
    expect(
      selectContentEncoding("*;q=0.5", {
        brotliAvailable: true,
        gzipAvailable: true,
        secure: true,
      }),
    ).toBe("br");
  });

  it("limits dynamic compression to textual response types", () => {
    expect(isCompressibleContentType("text/html; charset=utf-8")).toBe(true);
    expect(isCompressibleContentType("application/json")).toBe(true);
    expect(isCompressibleContentType("application/pdf")).toBe(false);
    expect(isCompressibleContentType("image/png")).toBe(false);
  });

  it("adds one case-insensitive Vary field without losing existing fields", () => {
    expect(appendVary("Cookie", "Accept-Encoding")).toBe(
      "Cookie, Accept-Encoding",
    );
    expect(appendVary("Accept-Encoding", "accept-encoding")).toBe(
      "Accept-Encoding",
    );
    expect(appendVary("*", "Accept-Encoding")).toBe("*");
  });
});
