import { execFile } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

// Thumbnail PDF (prima pagină) prin poppler-utils (`pdftoppm`), nu prin Puppeteer/Chromium —
// randarea headless a viewer-ului nativ de PDF e cunoscută ca fragilă (PDFium injectat ca
// <embed>, fără garanție că e "gata" la screenshot) și ar concura cu browser-ul singleton
// folosit pt. facturi (shared/lib/pdf.ts). pdftoppm e determinist și nu ține stare.
//
// Best-effort, la fel ca isPdfAvailable() din pdf.ts: dacă poppler-utils lipsește din imagine
// sau PDF-ul e corupt/criptat, întoarce null — upload-ul fișierului original nu e blocat de asta.
export async function generatePdfThumbnail(pdfBuffer: Buffer): Promise<Buffer | null> {
  const dir = await mkdtemp(join(tmpdir(), 'archive-thumb-'))
  try {
    const inputPath = join(dir, 'input.pdf')
    const outputPrefix = join(dir, 'out')
    await writeFile(inputPath, pdfBuffer)
    await execFileAsync('pdftoppm', [
      '-jpeg',
      '-f',
      '1',
      '-l',
      '1',
      '-scale-to-x',
      '480',
      '-scale-to-y',
      '-1',
      inputPath,
      outputPrefix,
    ])
    // Lățimea numerotării paginii în numele fișierului depinde de argumentul -l (1 → "out-1.jpg"),
    // nu de nr. total de pagini din document — dar căutăm cu prefix ca să nu depindem de asta.
    const files = await readdir(dir)
    const outFile = files.find((f) => f.startsWith('out-') && f.endsWith('.jpg'))
    if (!outFile) return null
    return await readFile(join(dir, outFile))
  } catch {
    return null
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

// A photo from a phone is several megabytes; the chat thread shows it at under 300px. libvips
// (`vipsthumbnail`, the vips-tools package) shrinks it in a separate process, turns it by its
// EXIF orientation and drops the metadata. Best-effort like the PDF one: without the binary or
// with an unreadable file the caller serves the original.
export async function generateImageThumbnail(image: Buffer, maxSize = 640): Promise<Buffer | null> {
  const dir = await mkdtemp(join(tmpdir(), 'image-thumb-'))
  try {
    const inputPath = join(dir, 'input')
    const outputPath = join(dir, 'out.jpg')
    await writeFile(inputPath, image)
    await execFileAsync('vipsthumbnail', [inputPath, '--size', `${maxSize}x${maxSize}>`, '-o', `${outputPath}[Q=80,strip]`])
    return await readFile(outputPath)
  } catch {
    return null
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
