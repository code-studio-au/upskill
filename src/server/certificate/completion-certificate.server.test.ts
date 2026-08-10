import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { renderCompletionCertificate } from "./completion-certificate-pdf.server";

describe("completion certificate PDF", () => {
  it("renders a valid single-page PDF and replaces unsupported glyphs", async () => {
    const bytes = await renderCompletionCertificate({
      certificateId: "certificate_1",
      learnerName: "Zoë 🚀 Learner",
      courseTitle: "Safe meal support",
      completedAt: new Date("2026-08-10T00:00:00.000Z"),
    });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBe(1);
    expect(parsed.getTitle()).toBe(
      "Completion certificate - Safe meal support",
    );
  });
});
