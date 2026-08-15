export type CsvValue = string | number | boolean | null;

function csvCell(value: CsvValue): string {
  const text = value === null ? "" : String(value);
  const safe = /^[=+\-@\t\r]/u.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function encodeCsv(
  rows: ReadonlyArray<ReadonlyArray<CsvValue>>,
): string {
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
