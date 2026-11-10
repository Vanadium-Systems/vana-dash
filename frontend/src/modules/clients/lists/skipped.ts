import { formatNumber } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import type { AddMembersResult } from './types'

/** "Omiși: 4 erau deja în listă, 2 fără telefon". Empty when nothing was left out. */
export function skippedSummary(skipped: AddMembersResult['skipped']): string {
  const parts = [
    skipped.alreadyIn > 0 ? t('clients:lists.skipped.alreadyIn', { n: formatNumber(skipped.alreadyIn) }) : '',
    skipped.inFolderLists > 0 ? t('clients:lists.skipped.inFolderLists', { n: formatNumber(skipped.inFolderLists) }) : '',
    skipped.withoutPhone > 0 ? t('clients:lists.skipped.withoutPhone', { n: formatNumber(skipped.withoutPhone) }) : '',
    skipped.doNotContact > 0 ? t('clients:lists.skipped.doNotContact', { n: formatNumber(skipped.doNotContact) }) : '',
    skipped.notVisible > 0 ? t('clients:lists.skipped.notVisible', { n: formatNumber(skipped.notVisible) }) : '',
  ].filter(Boolean)
  return parts.length ? t('clients:lists.skipped.prefix', { list: parts.join(', ') }) : ''
}
