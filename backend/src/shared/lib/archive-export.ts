import * as archiveService from '../../modules/archive/service.js'
import { downloadFromR2 } from './r2.js'

// Re-împachetare a fișierelor deja arhivate (modules/archive) în zip-uri pt. livrabile externe —
// folosit de pachetul trimestrial (Sprint D, Track B). Trăiește în shared/lib, nu în
// modules/accounting, ca să nu încalce regula #5 CLAUDE.md (module izolate, fără cross-import
// direct între module) — mirror exact pe financial-archive.ts, care importă modules/archive tot
// din shared/lib.

export interface CollectedFile {
  /** Nume unic în zip, cu prefix lună + subfolderele originale (evită coliziuni între luni). */
  zipPath: string
  buffer: Buffer
}

/**
 * Toate fișierele arhivate sub `Contabilitate/<monthFolderName>` (ex: '07-2026'), pt. fiecare
 * lună din listă — best-effort per fișier: un download eșuat (R2 jos) nu oprește restul
 * pachetului (regula #7 CLAUDE.md), doar lipsește din zip.
 */
export async function collectArchiveFilesForMonths(monthFolderNames: string[]): Promise<CollectedFile[]> {
  const collected: CollectedFile[] = []
  // Jobul rulează ca „sistem", deci merge în spațiul lui Stefan (vezi `systemArchiveRoot`) —
  // cu spații per om nu mai există o rădăcină comună de căutat.
  const rootId = await archiveService.systemArchiveRoot()
  for (const monthFolderName of monthFolderNames) {
    const folderId = await archiveService.findFolderIdByPath(rootId, ['Contabilitate', monthFolderName])
    if (!folderId) continue // nicio factură arhivată încă în luna asta — normal, nu o eroare

    const files = await archiveService.listFilesUnderFolderRecursive(folderId)
    for (const file of files) {
      try {
        const buffer = await downloadFromR2(file.r2Key)
        const pathSegments = [monthFolderName, ...file.folderPathNames, file.name]
        collected.push({ zipPath: pathSegments.join('/'), buffer })
      } catch (err) {
        console.error(`[archive-export] nu am putut descărca "${file.name}" (${file.r2Key}): ${String(err)}`)
      }
    }
  }
  return collected
}
