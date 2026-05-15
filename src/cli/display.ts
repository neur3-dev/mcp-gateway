export function printTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((h, i) => {
    const colMax = rows.reduce((max, row) => Math.max(max, (row[i] ?? "").length), 0);
    return Math.max(h.length, colMax);
  });

  const fmt = (cells: string[]) =>
    cells.map((c, i) => (c ?? "").padEnd(widths[i])).join("   ");

  console.log(fmt(headers));
  for (const row of rows) {
    console.log(fmt(row));
  }
}

export function printError(msg: string): void {
  process.stderr.write(`Error: ${msg}\n`);
}
