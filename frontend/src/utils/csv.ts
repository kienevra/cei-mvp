// frontend/src/utils/csv.ts

export type CsvRow = Record<string, any>;

/**
 * Basic CSV builder + download trigger.
 * - Uses the keys of the first row as headers.
 * - Escapes quotes, commas, and newlines.
 */
export function downloadCsv(filename: string, rows: CsvRow[]): void {
  if (!rows || rows.length === 0) return;

  const headers = Object.keys(rows[0]);

  const escapeCell = (value: any): string => {
    if (value === null || value === undefined) return "";
    const str = String(value);
    if (str.includes('"') || str.includes(",") || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const lines: string[] = [
    headers.join(","),
    ...rows.map((row) =>
      headers.map((h) => escapeCell(row[h])).join(",")
    ),
  ];

  const blob = new Blob([lines.join("\n")], {
    type: "text/csv;charset=utf-8;",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
