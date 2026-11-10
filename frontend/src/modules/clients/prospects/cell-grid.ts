// Arrow keys between the editable cells of the table (`data-cell-row` / `data-cell-col`), as in a spreadsheet.
// Cells of hidden columns (`display: none`) have no `offsetParent` and are skipped.

const STEP: Record<string, [row: number, col: number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }

export function moveCellFocus(grid: HTMLElement, from: HTMLElement, key: string): boolean {
  const step = STEP[key]
  if (!step || from.dataset.cellRow === undefined) return false
  const cells = [...grid.querySelectorAll<HTMLElement>('[data-cell-row]')].filter((cell) => cell.offsetParent !== null)
  let row = Number(from.dataset.cellRow)
  let col = Number(from.dataset.cellCol)
  const maxRow = Math.max(...cells.map((cell) => Number(cell.dataset.cellRow)))
  const maxCol = Math.max(...cells.map((cell) => Number(cell.dataset.cellCol)))
  while (row >= 0 && col >= 0 && row <= maxRow && col <= maxCol) {
    row += step[0]
    col += step[1]
    const target = cells.find((cell) => Number(cell.dataset.cellRow) === row && Number(cell.dataset.cellCol) === col)
    if (target) {
      target.focus()
      return true
    }
  }
  return false
}
