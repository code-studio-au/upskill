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

export interface CertificateTextLayout {
  lines: Array<string>;
  size: number;
}

function wrapText(
  font: PDFFont,
  text: string,
  size: number,
  maxWidth: number,
): Array<string> {
  const words = text.trim().replaceAll(/\s+/gu, " ").split(" ");
  const lines: Array<string> = [];
  let line = "";

  function appendWord(word: string): void {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
      return;
    }
    if (line) {
      lines.push(line);
      line = "";
    }
    if (font.widthOfTextAtSize(word, size) <= maxWidth) {
      line = word;
      return;
    }
    let fragment = "";
    for (const character of word) {
      const next = fragment + character;
      if (fragment && font.widthOfTextAtSize(next, size) > maxWidth) {
        lines.push(fragment);
        fragment = character;
      } else {
        fragment = next;
      }
    }
    line = fragment;
  }

  for (const word of words) appendWord(word);
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [""];
}

function truncateToWidth(
  font: PDFFont,
  text: string,
  size: number,
  maxWidth: number,
): string {
  const suffix = "...";
  let value = text.trim();
  while (
    value.length > 0 &&
    font.widthOfTextAtSize(`${value}${suffix}`, size) > maxWidth
  )
    value = value.slice(0, -1).trimEnd();
  return `${value}${suffix}`;
}

export function fitCertificateText(
  font: PDFFont,
  value: string,
  options: {
    preferredSize: number;
    minimumSize: number;
    maxWidth: number;
    maxLines: number;
  },
): CertificateTextLayout {
  const safeText = supportedText(font, value);
  for (
    let size = options.preferredSize;
    size >= options.minimumSize;
    size -= 1
  ) {
    const lines = wrapText(font, safeText, size, options.maxWidth);
    if (lines.length <= options.maxLines) return { lines, size };
  }

  const lines = wrapText(font, safeText, options.minimumSize, options.maxWidth);
  const visible = lines.slice(0, options.maxLines);
  visible[options.maxLines - 1] = truncateToWidth(
    font,
    lines.slice(options.maxLines - 1).join(" "),
    options.minimumSize,
    options.maxWidth,
  );
  return { lines: visible, size: options.minimumSize };
}

function drawFittedCentredText(
  page: ReturnType<PDFDocument["addPage"]>,
  font: PDFFont,
  text: string,
  y: number,
  options: {
    preferredSize: number;
    minimumSize?: number;
    maxLines?: number;
    maxWidth?: number;
  },
  color = rgb(0.08, 0.1, 0.18),
): void {
  const maxWidth = options.maxWidth ?? page.getWidth() - 96;
  const layout = fitCertificateText(font, text, {
    preferredSize: options.preferredSize,
    minimumSize: options.minimumSize ?? options.preferredSize,
    maxWidth,
    maxLines: options.maxLines ?? 1,
  });
  const lineHeight = layout.size * 1.25;
  for (const [index, line] of layout.lines.entries()) {
    const width = font.widthOfTextAtSize(line, layout.size);
    page.drawText(line, {
      x: (page.getWidth() - width) / 2,
      y: y - index * lineHeight,
      size: layout.size,
      font,
      color,
    });
  }
}

export async function renderCompletionCertificate(input: {
  completionReference: string;
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
  drawFittedCentredText(
    page,
    bold,
    "UPSKILL",
    500,
    { preferredSize: 18 },
    indigo,
  );
  drawFittedCentredText(page, bold, "Certificate of completion", 425, {
    preferredSize: 34,
  });
  drawFittedCentredText(page, regular, "This certifies that", 368, {
    preferredSize: 16,
  });
  drawFittedCentredText(
    page,
    bold,
    input.learnerName,
    320,
    { preferredSize: 28, minimumSize: 16, maxLines: 2 },
    indigo,
  );
  drawFittedCentredText(page, regular, "completed", 258, {
    preferredSize: 16,
  });
  drawFittedCentredText(page, bold, input.courseTitle, 218, {
    preferredSize: 24,
    minimumSize: 14,
    maxLines: 3,
  });
  drawFittedCentredText(
    page,
    regular,
    completionDateFormatter.format(input.completedAt),
    125,
    { preferredSize: 15 },
  );
  drawFittedCentredText(
    page,
    regular,
    `Completion reference: ${input.completionReference}`,
    74,
    { preferredSize: 9, minimumSize: 7 },
    rgb(0.35, 0.38, 0.45),
  );
  return document.save();
}
