import { describe, expect, it } from "vitest";
import {
  parseScormContentPath,
  parseScormRange,
  resolveScormContentType,
} from "./scorm-content-path";

describe("SCORM content request boundaries", () => {
  it("accepts normalized nested package paths", () => {
    expect(parseScormContentPath("assets/images/slide-1.webp")).toBe(
      "assets/images/slide-1.webp",
    );
  });

  it.each(["", "/index.html", "../index.html", "a/../index.html", "a\\b.js"])(
    "rejects an unsafe package path: %s",
    (path) => {
      expect(parseScormContentPath(path)).toBeNull();
    },
  );

  it("accepts only one bounded byte range", () => {
    expect(parseScormRange("bytes=100-200")).toBe("bytes=100-200");
    expect(parseScormRange("bytes=100-")).toBe("bytes=100-");
    expect(parseScormRange("bytes=0-1,5-6")).toBeUndefined();
    expect(parseScormRange("items=0-10")).toBeUndefined();
  });

  it("supplies browser-safe media types for older extracted objects", () => {
    expect(resolveScormContentType("media/lesson.mp4", undefined)).toBe(
      "video/mp4",
    );
    expect(resolveScormContentType("media/audio.mp3", "audio/custom")).toBe(
      "audio/custom",
    );
  });
});
