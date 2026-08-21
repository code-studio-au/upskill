import "@tanstack/react-start/server-only";

import fontkit from "@pdf-lib/fontkit";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  PDFDocument,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import type { CertificateAccreditation } from "#/features/catalog/accreditation";

const require = createRequire(import.meta.url);
const navy = rgb(0.02, 0.08, 0.25);
const indigo = rgb(0.16, 0.3, 0.86);
const muted = rgb(0.28, 0.34, 0.48);
const paleIndigo = rgb(0.91, 0.94, 1);
const iconBorder = rgb(0.71, 0.79, 1);

type CertificateAccreditationInput = CertificateAccreditation & {
  logoBytes?: Uint8Array;
  logoMediaType?: "image/png" | "image/jpeg";
};

async function readPublicAsset(relativePath: string): Promise<Uint8Array> {
  const candidates = [
    resolve("dist/client", relativePath),
    resolve("public", relativePath),
  ];
  for (const candidate of candidates)
    try {
      return await readFile(candidate);
    } catch {
      // The development and production layouts use different asset roots.
    }
  throw new Error(`Certificate asset not found: ${relativePath}`);
}

async function loadCertificateAssets() {
  return Promise.all([
    readFile(
      require.resolve("@fontsource/inter/files/inter-latin-400-normal.woff"),
    ),
    readFile(
      require.resolve("@fontsource/inter/files/inter-latin-700-normal.woff"),
    ),
    readPublicAsset("brand/home-arrow-background.jpg"),
    readPublicAsset("brand/upskill-icon-navy.png"),
    readPublicAsset("brand/upskill-wordmark-navy.png"),
  ]);
}

function drawPageBackground(page: PDFPage, background: PDFImage): void {
  page.drawImage(background, {
    x: 0,
    y: 0,
    width: page.getWidth(),
    height: page.getHeight(),
    opacity: 0.76,
  });
  page.drawRectangle({
    x: 0,
    y: 0,
    width: page.getWidth(),
    height: page.getHeight(),
    color: rgb(1, 1, 1),
    opacity: 0.38,
  });
  page.drawRectangle({
    x: 13,
    y: 13,
    width: page.getWidth() - 26,
    height: page.getHeight() - 26,
    borderColor: rgb(0.75, 0.82, 1),
    borderWidth: 5,
    borderOpacity: 0.45,
  });
  page.drawRectangle({
    x: 19,
    y: 19,
    width: page.getWidth() - 38,
    height: page.getHeight() - 38,
    borderColor: indigo,
    borderWidth: 0.8,
    borderOpacity: 0.55,
  });
}

function drawBrand(page: PDFPage, icon: PDFImage, wordmark: PDFImage): void {
  const iconSize = 68;
  const wordmarkWidth = 225;
  const wordmarkHeight = 43;
  const gap = 11;
  const brandWidth = iconSize + gap + wordmarkWidth;
  const brandStart = (page.getWidth() - brandWidth) / 2;
  const wordmarkY = 515;
  page.drawImage(icon, {
    x: brandStart,
    y: wordmarkY + (wordmarkHeight - iconSize) / 2,
    width: iconSize,
    height: iconSize,
  });
  page.drawImage(wordmark, {
    x: brandStart + iconSize + gap,
    y: wordmarkY,
    width: wordmarkWidth,
    height: wordmarkHeight,
  });
}

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
  page: PDFPage,
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

function drawFittedLeftText(
  page: PDFPage,
  font: PDFFont,
  text: string,
  options: {
    x: number;
    y: number;
    preferredSize: number;
    minimumSize?: number;
    maxLines: number;
    maxWidth: number;
    lineHeightFactor?: number;
    color?: ReturnType<typeof rgb>;
  },
): number {
  const layout = fitCertificateText(font, text, {
    preferredSize: options.preferredSize,
    minimumSize: options.minimumSize ?? options.preferredSize,
    maxWidth: options.maxWidth,
    maxLines: options.maxLines,
  });
  const lineHeight = layout.size * (options.lineHeightFactor ?? 1.25);
  for (const [index, line] of layout.lines.entries())
    page.drawText(line, {
      x: options.x,
      y: options.y - index * lineHeight,
      size: layout.size,
      font,
      color: options.color ?? muted,
    });
  return options.y - layout.lines.length * lineHeight;
}

function imageDimensionsWithin(
  image: PDFImage,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
  return { width: image.width * scale, height: image.height * scale };
}

function drawAccreditations(
  page: PDFPage,
  accreditations: Array<CertificateAccreditationInput>,
  logos: ReadonlyMap<string, PDFImage>,
  regular: PDFFont,
  bold: PDFFont,
): void {
  if (accreditations.length === 0) return;
  const gap = 8;
  const side = 48;
  const availableWidth = page.getWidth() - side * 2;
  const cardWidth = Math.min(
    220,
    (availableWidth - gap * (accreditations.length - 1)) /
      accreditations.length,
  );
  const totalWidth =
    cardWidth * accreditations.length + gap * (accreditations.length - 1);
  const gridStart = (page.getWidth() - totalWidth) / 2;
  const cardHeight = 116;
  const y = 83;

  for (const [index, accreditation] of accreditations.entries()) {
    const x = gridStart + index * (cardWidth + gap);
    const logo = accreditation.logoAssetId
      ? logos.get(accreditation.logoAssetId)
      : undefined;
    let contentY = y + cardHeight;
    if (logo) {
      const logoSize = imageDimensionsWithin(
        logo,
        Math.min(104, cardWidth - 8),
        40,
      );
      page.drawImage(logo, {
        x: x + (cardWidth - logoSize.width) / 2,
        y: contentY - logoSize.height,
        width: logoSize.width,
        height: logoSize.height,
      });
      contentY -= logoSize.height + 2;
    }
    if (accreditation.cpdPoints !== null) {
      const formattedPoints = new Intl.NumberFormat("en-AU", {
        maximumFractionDigits: 2,
      }).format(accreditation.cpdPoints);
      contentY = drawFittedLeftText(
        page,
        bold,
        `${formattedPoints} CPD ${accreditation.cpdPoints === 1 ? "point" : "points"}`,
        {
          x: x + 4,
          y: contentY,
          preferredSize: 6,
          minimumSize: 5,
          maxLines: 1,
          maxWidth: cardWidth - 8,
          lineHeightFactor: 1.08,
          color: indigo,
        },
      );
    }
    if (accreditation.blurb.trim())
      drawFittedLeftText(page, regular, accreditation.blurb, {
        x: x + 4,
        y: contentY - 1,
        preferredSize: 6,
        minimumSize: 5,
        maxLines: 12,
        maxWidth: cardWidth - 8,
        lineHeightFactor: 1.08,
      });
  }
}

function drawCalendarIcon(page: PDFPage, x: number, y: number): void {
  page.drawCircle({
    x,
    y,
    size: 19,
    color: paleIndigo,
    borderColor: iconBorder,
    borderWidth: 1,
  });
  page.drawRectangle({
    x: x - 8,
    y: y - 7,
    width: 16,
    height: 14,
    borderColor: indigo,
    borderWidth: 2.1,
  });
  page.drawLine({
    start: { x: x - 8, y: y + 2 },
    end: { x: x + 8, y: y + 2 },
    color: indigo,
    thickness: 2.1,
  });
  for (const offset of [-4, 4])
    page.drawLine({
      start: { x: x + offset, y: y + 9 },
      end: { x: x + offset, y: y + 5 },
      color: indigo,
      thickness: 2.1,
    });
}

function drawShieldIcon(page: PDFPage, x: number, y: number): void {
  page.drawCircle({
    x,
    y,
    size: 19,
    color: paleIndigo,
    borderColor: iconBorder,
    borderWidth: 1,
  });
  const outline = [
    { x, y: y + 9 },
    { x: x + 8, y: y + 5 },
    { x: x + 8, y: y - 1 },
    { x: x + 5, y: y - 7 },
    { x, y: y - 11 },
    { x: x - 5, y: y - 7 },
    { x: x - 8, y: y - 1 },
    { x: x - 8, y: y + 5 },
    { x, y: y + 9 },
  ];
  for (let index = 1; index < outline.length; index += 1) {
    const start = outline[index - 1];
    const end = outline[index];
    if (!start || !end) continue;
    page.drawLine({
      start,
      end,
      color: indigo,
      thickness: 2.1,
    });
  }
  page.drawLine({
    start: { x: x - 4, y: y },
    end: { x: x - 1, y: y - 3 },
    color: indigo,
    thickness: 2.1,
  });
  page.drawLine({
    start: { x: x - 1, y: y - 3 },
    end: { x: x + 5, y: y + 4 },
    color: indigo,
    thickness: 2.1,
  });
}

function drawGlobeIcon(page: PDFPage, x: number, y: number): void {
  page.drawCircle({
    x,
    y,
    size: 19,
    color: paleIndigo,
    borderColor: iconBorder,
    borderWidth: 1,
  });
  page.drawCircle({
    x,
    y,
    size: 9,
    borderColor: indigo,
    borderWidth: 2.1,
  });
  for (const offset of [-4, 4])
    page.drawLine({
      start: { x: x - 8, y: y + offset },
      end: { x: x + 8, y: y + offset },
      color: indigo,
      thickness: 1.2,
    });
  page.drawLine({
    start: { x, y: y - 9 },
    end: { x, y: y + 9 },
    color: indigo,
    thickness: 1.2,
  });
}

function drawInformationColumn(
  page: PDFPage,
  regular: PDFFont,
  bold: PDFFont,
  options: {
    centerX: number;
    label: string;
    value: string;
    icon: "calendar" | "shield" | "globe";
  },
): void {
  const iconX = options.centerX - 70;
  if (options.icon === "calendar") drawCalendarIcon(page, iconX, 47);
  else if (options.icon === "shield") drawShieldIcon(page, iconX, 47);
  else drawGlobeIcon(page, iconX, 47);
  page.drawText(options.label, {
    x: iconX + 26,
    y: 52,
    size: 8,
    font: regular,
    color: muted,
  });
  page.drawText(supportedText(bold, options.value), {
    x: iconX + 26,
    y: 37,
    size: 9,
    font: bold,
    color: navy,
  });
}

export async function renderCompletionCertificate(input: {
  completionReference: string;
  learnerName: string;
  learningTitle: string;
  learningSummary: string;
  accreditations: Array<CertificateAccreditationInput>;
  completedAt: Date;
}): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  document.setTitle(`Completion certificate - ${input.learningTitle}`);
  document.setSubject("Learning completion certificate");
  document.setCreator("Upskill Institute");
  const page = document.addPage([841.89, 595.28]);
  const [regularBytes, boldBytes, backgroundBytes, iconBytes, wordmarkBytes] =
    await loadCertificateAssets();
  const [regular, bold, background, icon, wordmark] = await Promise.all([
    document.embedFont(regularBytes, { subset: true }),
    document.embedFont(boldBytes, { subset: true }),
    document.embedJpg(backgroundBytes),
    document.embedPng(iconBytes),
    document.embedPng(wordmarkBytes),
  ]);
  const accreditationLogoEntries = await Promise.all(
    input.accreditations.flatMap((accreditation) => {
      const { logoAssetId, logoBytes, logoMediaType } = accreditation;
      if (!logoAssetId || !logoBytes || !logoMediaType) return [];
      return [
        (async () =>
          [
            logoAssetId,
            logoMediaType === "image/png"
              ? await document.embedPng(logoBytes)
              : await document.embedJpg(logoBytes),
          ] as const)(),
      ];
    }),
  );
  const accreditationLogos = new Map(accreditationLogoEntries);

  drawPageBackground(page, background);
  drawBrand(page, icon, wordmark);
  drawFittedCentredText(
    page,
    bold,
    "Certificate of Completion",
    454,
    {
      preferredSize: 34,
    },
    navy,
  );
  drawFittedCentredText(
    page,
    regular,
    "Proudly presented to",
    410,
    {
      preferredSize: 11,
    },
    muted,
  );
  drawFittedCentredText(
    page,
    bold,
    input.learnerName,
    365,
    { preferredSize: 31, minimumSize: 17, maxLines: 2, maxWidth: 640 },
    navy,
  );
  drawFittedCentredText(
    page,
    regular,
    "For successfully completing",
    307,
    {
      preferredSize: 11,
    },
    muted,
  );
  drawFittedCentredText(
    page,
    bold,
    input.learningTitle,
    280,
    {
      preferredSize: 23,
      minimumSize: 13,
      maxLines: 2,
      maxWidth: 650,
    },
    navy,
  );

  if (input.learningSummary.trim())
    drawFittedCentredText(
      page,
      regular,
      input.learningSummary,
      230,
      {
        preferredSize: 10,
        minimumSize: 7,
        maxLines: 2,
        maxWidth: 610,
      },
      muted,
    );

  drawAccreditations(
    page,
    input.accreditations,
    accreditationLogos,
    regular,
    bold,
  );

  page.drawRectangle({
    x: 112,
    y: 16,
    width: page.getWidth() - 224,
    height: 62,
    color: rgb(1, 1, 1),
    opacity: 0.9,
    borderColor: rgb(0.82, 0.86, 0.96),
    borderWidth: 0.7,
    borderOpacity: 0.8,
  });
  const completedDate = completionDateFormatter.format(input.completedAt);
  drawInformationColumn(page, regular, bold, {
    centerX: 220,
    label: "Completed on",
    value: completedDate,
    icon: "calendar",
  });
  drawInformationColumn(page, regular, bold, {
    centerX: 421,
    label: "Certificate ID",
    value: input.completionReference,
    icon: "shield",
  });
  drawInformationColumn(page, regular, bold, {
    centerX: 622,
    label: "Verified",
    value: "upskill.institute/verify",
    icon: "globe",
  });
  return document.save();
}
