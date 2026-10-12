/**
 * jobs/archive-monthly-folders.ts — creare lunară de subfoldere "LL-AAAA". modules/archive/
 * service.js mockuit la graniță — verificăm orchestrarea: idempotență (delegată la
 * ensureFolder), izolarea erorilor per folder (regula #7 CLAUDE.md).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const listAutoMonthlyFoldersMock = vi.fn()
const ensureFolderMock = vi.fn()

vi.mock('../modules/archive/service.js', () => ({
  listAutoMonthlyFolders: (...args: unknown[]) => listAutoMonthlyFoldersMock(...args),
  ensureFolder: (...args: unknown[]) => ensureFolderMock(...args),
  monthYearFolderName: (date: Date) => `${String(date.getUTCMonth() + 1).padStart(2, '0')}-${date.getUTCFullYear()}`,
}))

const { runArchiveMonthlyFoldersJob } = await import('./archive-monthly-folders.js')

function reset() {
  listAutoMonthlyFoldersMock.mockReset()
  ensureFolderMock.mockReset()
  ensureFolderMock.mockResolvedValue('subfolder-1')
}

describe('runArchiveMonthlyFoldersJob', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-01T05:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('nu face nimic când niciun folder nu are autoMonthlySubfolders activ', async () => {
    reset()
    listAutoMonthlyFoldersMock.mockResolvedValue([])
    await runArchiveMonthlyFoldersJob()
    expect(ensureFolderMock).not.toHaveBeenCalled()
  })

  it('creează subfolderul lunii curente ("07-2026") pt. fiecare folder marcat', async () => {
    reset()
    listAutoMonthlyFoldersMock.mockResolvedValue([{ id: 'folder-1', name: 'Contabilitate' }])
    await runArchiveMonthlyFoldersJob()
    expect(ensureFolderMock).toHaveBeenCalledWith('07-2026', 'folder-1')
  })

  it('izolează eroarea la un folder — continuă cu restul (regula #7)', async () => {
    reset()
    listAutoMonthlyFoldersMock.mockResolvedValue([
      { id: 'folder-1', name: 'Contabilitate' },
      { id: 'folder-2', name: 'Contracte' },
    ])
    ensureFolderMock.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('subfolder-2')
    await expect(runArchiveMonthlyFoldersJob()).resolves.toBeUndefined()
    expect(ensureFolderMock).toHaveBeenCalledTimes(2)
  })
})
