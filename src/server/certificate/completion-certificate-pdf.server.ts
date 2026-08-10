import "@tanstack/react-start/server-only";

import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

const completionDateFormatter = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function supportedText(font: PDFFont, value: string): string {
  return Array.from(value, (character) => {
    try {
      font.encodeText(character);
      return character;
    } catch {
      return "?";
    }
  }).join("");
}

function drawCentredText(
  page: ReturnType<PDFDocument["addPage"]>,
  font: PDFFont,
  text: string,
  y: number,
  size: number,
  color = rgb(0.08, 0.1, 0.18),
): void {
  const safeText = supportedText(font, text);
  const width = font.widthOfTextAtSize(safeText, size);
  page.drawText(safeText, {
    x: Math.max(48, (page.getWidth() - width) / 2),
    y,
    size,
    font,
    color,
  });
}

export async function renderCompletionCertificate(input: {
  certificateId: string;
  learnerName: string;
  courseTitle: string;
  completedAt: Date;
}): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.setTitle(`Completion certificate - ${input.courseTitle}`);
  document.setSubject("Course completion certificate");
  document.setCreator("Upskill");
  const page = document.addPage([841.89, 595.28]);
  const [regular, bold] = await Promise.all([
    document.embedFont(StandardFonts.Helvetica),
    document.embedFont(StandardFonts.HelveticaBold),
  ]);
  const indigo = rgb(0.18, 0.3, 0.84);

  page.drawRectangle({
    x: 24,
    y: 24,
    width: page.getWidth() - 48,
    height: page.getHeight() - 48,
    borderColor: indigo,
    borderWidth: 3,
  });
  drawCentredText(page, bold, "UPSKILL", 500, 18, indigo);
  drawCentredText(page, bold, "Certificate of completion", 425, 34);
  drawCentredText(page, regular, "This certifies that", 368, 16);
  drawCentredText(page, bold, input.learnerName, 310, 28, indigo);
  drawCentredText(page, regular, "completed", 264, 16);
  drawCentredText(page, bold, input.courseTitle, 215, 24);
  drawCentredText(
    page,
    regular,
    completionDateFormatter.format(input.completedAt),
    145,
    15,
  );
  drawCentredText(
    page,
    regular,
    `Certificate ID: ${input.certificateId}`,
    74,
    9,
    rgb(0.35, 0.38, 0.45),
  );
  return document.save();
}
