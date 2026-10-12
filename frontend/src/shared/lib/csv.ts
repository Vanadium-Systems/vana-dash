// Export CSV client-side — datele sunt deja în state (calcul/config deja încărcat), fără
// round-trip la server. Pattern identic downloadMonthlySnapshotPdf (ReportsPage.tsx): Blob +
// object URL + <a> temporar.
function escapeCsvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function downloadCsv(filename: string, rows: string[][]): void {
  const body = rows.map((row) => row.map(escapeCsvCell).join(',')).join('\n')
  // BOM UTF-8 (﻿) — altfel Excel deschide diacriticele (ă/â/î/ș/ț) stricate.
  const blob = new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
