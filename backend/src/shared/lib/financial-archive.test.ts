/**
 * shared/lib/financial-archive.ts — orchestrare pură, modules/archive/service.js și
 * ./storage.js mockuite la graniță (au propriile teste). Verificăm: path-ul de foldere
 * corect (Contabilitate/LL-AAAA/Facturi.../<contraparte>), numele fișierelor, idempotența
 * (findFileByName → skip upload), și izolarea erorilor per fișier (regula #7 CLAUDE.md) —
 * un fișier lipsă pe disc (ex: PDF-ul ANAF încă nedescărcat) nu blochează restul.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const ensureFolderPathMock = vi.fn()
const findFileByNameMock = vi.fn()
const uploadFileMock = vi.fn()
const readDocumentMock = vi.fn()

vi.mock('../../modules/archive/service.js', () => ({
  ensureFolderPath: (...args: unknown[]) => ensureFolderPathMock(...args),
  findFileByName: (...args: unknown[]) => findFileByNameMock(...args),
  uploadSystemFile: (...args: unknown[]) => uploadFileMock(...args),
  systemArchiveRoot: async () => 'root-stefan',
  monthYearFolderName: (date: Date) => `${String(date.getUTCMonth() + 1).padStart(2, '0')}-${date.getUTCFullYear()}`,
}))
vi.mock('./storage.js', () => ({
  readDocument: (...args: unknown[]) => readDocumentMock(...args),
}))

const { archiveInvoiceDocuments } = await import('./financial-archive.js')

const baseInvoice = {
  issuedAt: new Date('2026-07-15T00:00:00Z'),
  counterpartyName: 'Hetzner Online GmbH',
  counterpartyCif: 'DE812871812',
  documentNumber: 'ACC1786',
  anafMessageId: 'msg-123',
  pdfStoragePath: 'incoming/2026/anaf_msg-123.pdf',
  xmlStoragePath: 'incoming/2026/anaf_msg-123.xml',
}

beforeEach(() => {
  vi.clearAllMocks()
  ensureFolderPathMock.mockResolvedValue('folder-id-1')
  findFileByNameMock.mockResolvedValue(undefined) // nimic arhivat încă, implicit
  uploadFileMock.mockResolvedValue({ id: 'file-id-1' })
  readDocumentMock.mockResolvedValue(Buffer.from('fake bytes'))
})

describe('archiveInvoiceDocuments — factură primită (direction=\'in\')', () => {
  it('construiește path-ul Contabilitate/LL-AAAA/Facturi furnizori/<contraparte> și urcă PDF+XML', async () => {
    await archiveInvoiceDocuments({ ...baseInvoice, direction: 'in' })

    expect(ensureFolderPathMock).toHaveBeenCalledWith('root-stefan', ['Contabilitate', '07-2026', 'Facturi furnizori', 'Hetzner Online GmbH'])
    expect(uploadFileMock).toHaveBeenCalledWith(
      expect.objectContaining({ folderId: 'folder-id-1', name: 'ACC1786.pdf', mimeType: 'application/pdf' }),
    )
    expect(uploadFileMock).toHaveBeenCalledWith(
      expect.objectContaining({ folderId: 'folder-id-1', name: 'ACC1786.xml', mimeType: 'application/xml' }),
    )
    expect(uploadFileMock).toHaveBeenCalledTimes(2) // fără al treilea fișier (ANAF PDF) pt. facturi primite
  })

  it('fallback pe anafMessageId când documentNumber lipsește (cazul real al facturilor primite)', async () => {
    await archiveInvoiceDocuments({ ...baseInvoice, direction: 'in', documentNumber: null })
    expect(uploadFileMock).toHaveBeenCalledWith(expect.objectContaining({ name: 'msg-123.pdf' }))
  })

  it('fallback pe "Necunoscut" când nu există nici nume nici CIF de contraparte', async () => {
    await archiveInvoiceDocuments({ ...baseInvoice, direction: 'in', counterpartyName: null, counterpartyCif: null })
    expect(ensureFolderPathMock).toHaveBeenCalledWith('root-stefan', ['Contabilitate', '07-2026', 'Facturi furnizori', 'Necunoscut'])
  })
})

describe('archiveInvoiceDocuments — factură emisă (direction=\'out\')', () => {
  it('folosește folderul "Facturi clienti" și arhivează și al treilea fișier (PDF-ul ANAF) când e disponibil', async () => {
    await archiveInvoiceDocuments({ ...baseInvoice, direction: 'out', anafPdfStoragePath: 'outgoing/2026/anaf_msg-123.pdf' })

    expect(ensureFolderPathMock).toHaveBeenCalledWith('root-stefan', ['Contabilitate', '07-2026', 'Facturi clienti', 'Hetzner Online GmbH'])
    expect(uploadFileMock).toHaveBeenCalledWith(expect.objectContaining({ name: 'ACC1786.pdf' }))
    expect(uploadFileMock).toHaveBeenCalledWith(expect.objectContaining({ name: 'ACC1786.xml' }))
    expect(uploadFileMock).toHaveBeenCalledWith(expect.objectContaining({ name: 'ACC1786_ANAF.pdf' }))
    expect(uploadFileMock).toHaveBeenCalledTimes(3)
  })

  it('fără anafPdfStoragePath (încă nedescărcat), arhivează doar 2 fișiere — al treilea vine la o rulare ulterioară', async () => {
    await archiveInvoiceDocuments({ ...baseInvoice, direction: 'out' })
    expect(uploadFileMock).toHaveBeenCalledTimes(2)
  })
})

describe('archiveInvoiceDocuments — idempotență și izolare erori', () => {
  it('nu re-arhivează un fișier deja prezent în folder (findFileByName îl găsește)', async () => {
    findFileByNameMock.mockImplementation(async (_folderId: string, name: string) =>
      name === 'ACC1786.pdf' ? { id: 'already-there' } : undefined,
    )
    await archiveInvoiceDocuments({ ...baseInvoice, direction: 'in' })

    expect(uploadFileMock).toHaveBeenCalledTimes(1)
    expect(uploadFileMock).toHaveBeenCalledWith(expect.objectContaining({ name: 'ACC1786.xml' }))
  })

  it('un fișier lipsă pe disc (ex: PDF ANAF încă nedescărcat) nu blochează arhivarea celorlalte', async () => {
    readDocumentMock.mockImplementation(async (path: string) => {
      if (path.includes('anaf_msg-123.pdf') && path.startsWith('outgoing/')) throw new Error('ENOENT')
      return Buffer.from('fake bytes')
    })

    await expect(
      archiveInvoiceDocuments({ ...baseInvoice, direction: 'out', anafPdfStoragePath: 'outgoing/2026/anaf_msg-123.pdf' }),
    ).resolves.toBeUndefined()

    expect(uploadFileMock).toHaveBeenCalledWith(expect.objectContaining({ name: 'ACC1786.pdf' }))
    expect(uploadFileMock).toHaveBeenCalledWith(expect.objectContaining({ name: 'ACC1786.xml' }))
    expect(uploadFileMock).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'ACC1786_ANAF.pdf' }))
  })

  it('eșecul creării folderului (ensureFolderPath) nu aruncă — doar renunță la arhivarea acestei facturi', async () => {
    ensureFolderPathMock.mockRejectedValueOnce(new Error('DB indisponibilă'))
    await expect(archiveInvoiceDocuments({ ...baseInvoice, direction: 'in' })).resolves.toBeUndefined()
    expect(uploadFileMock).not.toHaveBeenCalled()
  })
})
