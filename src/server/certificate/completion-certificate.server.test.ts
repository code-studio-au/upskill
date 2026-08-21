import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  fitCertificateText,
  renderCompletionCertificate,
} from "./completion-certificate-pdf.server";

describe("completion certificate PDF", () => {
  it("renders a valid single-page PDF and replaces unsupported glyphs", async () => {
    const bytes = await renderCompletionCertificate({
      completionReference: "COMPLETION-1",
      learnerName: "Zoë 🚀 Learner",
      learningTitle: "Safe meal support",
      learningSummary:
        "Practical guidance for supporting people with eating disorders before, during and after meals.",
      accreditations: [
        {
          name: "Clinical education",
          cpdPoints: 2.5,
          blurb: "Recognised professional learning.",
          logoAssetId: null,
          logoName: "",
        },
      ],
      completedAt: new Date("2026-08-10T00:00:00.000Z"),
    });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBe(1);
    expect(parsed.getTitle()).toBe(
      "Completion certificate - Safe meal support",
    );
  });

  it("fits long learner and course names inside the certificate content width", async () => {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.HelveticaBold);
    const maxWidth = 841.89 - 96;
    const learnerName =
      "Alexandra Catherine Montgomery-Wellington the Third of the Northern Clinical Education and Professional Development Directorate";
    const courseTitle =
      "Advanced multidisciplinary approaches to prevention, early identification, assessment, diagnosis, intervention and continuing support in complex care settings";

    const learnerLayout = fitCertificateText(font, learnerName, {
      preferredSize: 28,
      minimumSize: 16,
      maxWidth,
      maxLines: 2,
    });
    const courseLayout = fitCertificateText(font, courseTitle, {
      preferredSize: 24,
      minimumSize: 14,
      maxWidth,
      maxLines: 3,
    });

    expect(learnerLayout.lines.length).toBeLessThanOrEqual(2);
    expect(courseLayout.lines.length).toBeLessThanOrEqual(3);
    for (const layout of [learnerLayout, courseLayout])
      expect(
        layout.lines.every(
          (line) => font.widthOfTextAtSize(line, layout.size) <= maxWidth,
        ),
      ).toBe(true);

    const bytes = await renderCompletionCertificate({
      completionReference: "COMPLETION-WITH-LONG-TEXT",
      learnerName,
      learningTitle: courseTitle,
      learningSummary:
        "A comprehensive learning activity covering evidence-informed clinical practice across multidisciplinary care settings and professional contexts.",
      accreditations: [
        {
          name: "Australian professional development accreditation programme",
          cpdPoints: 12,
          blurb:
            "Completion of this learning activity contributes to continuing professional development.",
          logoAssetId: null,
          logoName: "",
        },
      ],
      completedAt: new Date("2026-08-10T00:00:00.000Z"),
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
});
