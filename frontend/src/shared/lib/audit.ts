import { t } from '@/shared/lib/i18n'
/** O intrare din `audit_log` (PLAN.md C2): cine a făcut ce, pe ce obiect, cu ce schimbări. */
export interface AuditListItem {
  id: string
  /** `null` = sistem sau job, nu un om. */
  actor: { id: string; displayName: string | null } | null
  action: string
  entityType: string
  entityId: string | null
  /** `{ camp: [vechi, nou] }`; absent pe acțiunile fără modificări de câmpuri. */
  changes: Record<string, [unknown, unknown]> | null
  createdAt: string
}

/** Acțiunile auditate, în română — un singur loc, folosit de pagina Istoric și de panoul de pe obiect. */
const ACTION_LABEL: Record<string, string> = {
  'client.creat': t('common:audit.actions.clientCreated'),
  'client.modificat': t('common:audit.actions.clientChanged'),
  'factura.emitata': t('common:audit.actions.invoiceIssued'),
  'factura.trimisa.anaf': t('common:audit.actions.invoiceSentToAnaf'),
  'acces.rol.creat': t('common:audit.actions.roleCreated'),
  'acces.rol.redenumit': t('common:audit.actions.roleRenamed'),
  'acces.rol.sters': t('common:audit.actions.roleDeleted'),
  'acces.rol.functionalitate.activata': t('common:audit.actions.featureOn'),
  'acces.rol.functionalitate.oprita': t('common:audit.actions.featureOff'),
  'acces.rol.pagina.activata': t('common:audit.actions.pageOn'),
  'acces.rol.pagina.oprita': t('common:audit.actions.pageOff'),
  'echipa.invitare': t('common:audit.actions.inviteSent'),
  'echipa.invitatie.acceptata': t('common:audit.actions.inviteAccepted'),
  'echipa.invitare.retrimisa': t('common:audit.actions.inviteResent'),
  'echipa.cutii.schimbate': t('common:audit.actions.mailboxesChanged'),
  'echipa.dezactivare': t('common:audit.actions.personDisabled'),
  'echipa.actualizare': t('common:audit.actions.personChanged'),
  'echipa.parola.resetare': t('common:audit.actions.passwordReset'),
  'parola.resetata': t('common:audit.actions.passwordReset'),
  'parola.schimbata': t('common:audit.actions.passwordChanged'),
  'contract.anexa.creata': t('common:audit.actions.addendumCreated'),
  'contract.pdf.semnat.incarcat': t('common:audit.actions.signedPdfUploaded'),
  'contract.semnat': t('common:audit.actions.contractSigned'),
  'contract.semnatura.anulata': t('common:audit.actions.signatureCancelled'),
  'contract.termeni.modificati': t('common:audit.actions.termsChanged'),
  'contract.numere-rezervate.modificate': t('common:audit.actions.reservedNumbersChanged'),
  'reconciliere.potrivire.manuala': t('common:audit.actions.manualMatch'),
  'prospect.responsabil.schimbat': t('common:audit.actions.prospectOwnerChanged'),
}

/** Acțiune necunoscută (de după acest fișier) → codul ei, ca text lizibil, nu un `undefined`. */
export function actionLabel(action: string): string {
  return ACTION_LABEL[action] ?? action.replace(/[._]/g, ' ')
}
