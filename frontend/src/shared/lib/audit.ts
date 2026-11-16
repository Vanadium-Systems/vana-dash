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
  viaToken?: { id: string; name: string } | null
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
  'echipa.stergere': t('common:audit.actions.personDeleted'),
  'echipa.actualizare': t('common:audit.actions.personChanged'),
  'echipa.parola.resetare': t('common:audit.actions.passwordReset'),
  'parola.resetata': t('common:audit.actions.passwordReset'),
  'parola.schimbata': t('common:audit.actions.passwordChanged'),
  'api_token.creat': t('common:audit.actions.apiTokenCreated'),
  'api_token.revocat': t('common:audit.actions.apiTokenRevoked'),
  'contract.anexa.creata': t('common:audit.actions.addendumCreated'),
  'contract.pdf.semnat.incarcat': t('common:audit.actions.signedPdfUploaded'),
  'contract.semnat': t('common:audit.actions.contractSigned'),
  'contract.semnatura.anulata': t('common:audit.actions.signatureCancelled'),
  'contract.termeni.modificati': t('common:audit.actions.termsChanged'),
  'contract.numere-rezervate.modificate': t('common:audit.actions.reservedNumbersChanged'),
  'reconciliere.potrivire.manuala': t('common:audit.actions.manualMatch'),
  'prospect.responsabil.schimbat': t('common:audit.actions.prospectOwnerChanged'),
  'arhiva.cos.restaurat': t('common:audit.actions.archiveRestored'),
  'arhiva.cos.sters_definitiv': t('common:audit.actions.archiveDeletedForever'),
  'arhiva.folder.atribuit': t('common:audit.actions.archiveFolderAssigned'),
  'arhiva.share.adaugat': t('common:audit.actions.archiveShareAdded'),
  'arhiva.share.scos': t('common:audit.actions.archiveShareRemoved'),
  'arhiva.spatii.atribuite': t('common:audit.actions.archiveSpacesAssigned'),
  'calendar.share.adaugat': t('common:audit.actions.calendarShareAdded'),
  'calendar.share.scos': t('common:audit.actions.calendarShareRemoved'),
  'client.pret.aplicat': t('common:audit.actions.clientPriceApplied'),
  'contabilitate.luna.inchisa': t('common:audit.actions.monthClosed'),
  'contabilitate.luna.redeschisa': t('common:audit.actions.monthReopened'),
  'email.sequence_resumed': t('common:audit.actions.sequenceResumed'),
  'factura.din.proforma': t('common:audit.actions.invoiceFromProforma'),
  'factura.duplicata': t('common:audit.actions.invoiceDuplicated'),
  'factura.email.confirmata': t('common:audit.actions.invoiceEmailConfirmed'),
  'factura.email.importata': t('common:audit.actions.invoiceEmailImported'),
  'factura.plata.adaugata': t('common:audit.actions.paymentAdded'),
  'factura.plata.stearsa': t('common:audit.actions.paymentDeleted'),
  'factura.storno.creata': t('common:audit.actions.stornoCreated'),
  'factura.storno.emisa': t('common:audit.actions.stornoIssued'),
  'inregistrare.plata.actualizata': t('common:audit.actions.recordPaymentChanged'),
  'proforma.anulata': t('common:audit.actions.proformaCancelled'),
  'proforma.convertita': t('common:audit.actions.proformaConverted'),
  'proforma.emisa': t('common:audit.actions.proformaIssued'),
  'proforma.facturata': t('common:audit.actions.proformaInvoiced'),
  'prospect.automatizare': t('common:audit.actions.prospectAutomation'),
  'prospect.automatizare.config': t('common:audit.actions.automationsChanged'),
  'prospect.colaborator.adaugat': t('common:audit.actions.collaboratorAdded'),
  'prospect.colaborator.scos': t('common:audit.actions.collaboratorRemoved'),
  'prospect.colaborator.setat': t('common:audit.actions.collaboratorsSet'),
  'prospect.contact.adaugat': t('common:audit.actions.contactAdded'),
  'prospect.contact.modificat': t('common:audit.actions.contactChanged'),
  'prospect.contact.sters': t('common:audit.actions.contactDeleted'),
  'prospect.creat': t('common:audit.actions.prospectCreated'),
  'prospect.eliberare.setari': t('common:audit.actions.releaseSettingsChanged'),
  'prospect.eliberat': t('common:audit.actions.prospectReleased'),
  'prospect.eliberat.automat': t('common:audit.actions.prospectReleasedAuto'),
  'prospect.eliberat.plecare': t('common:audit.actions.prospectReleasedLeaver'),
  'prospect.export': t('common:audit.actions.prospectsExported'),
  'prospect.import': t('common:audit.actions.prospectsImported'),
  'prospect.modificat': t('common:audit.actions.prospectChanged'),
  'prospect.oferta': t('common:audit.actions.offerSent'),
  'prospect.promovat': t('common:audit.actions.prospectPromoted'),
  'prospect.revendicat': t('common:audit.actions.prospectClaimed'),
  'prospect.scor.config': t('common:audit.actions.scoreChanged'),
  'prospect.sters': t('common:audit.actions.prospectDeleted'),
  'prospect.transferat': t('common:audit.actions.prospectTransferred'),
  'prospect.unit': t('common:audit.actions.prospectsMerged'),
  'prospect.unit.in': t('common:audit.actions.prospectMergedInto'),
  'sesiune.refolosita': t('common:audit.actions.sessionReused'),
}

/** Acțiune necunoscută (de după acest fișier) → codul ei, ca text lizibil, nu un `undefined`. */
export function actionLabel(action: string): string {
  return ACTION_LABEL[action] ?? action.replace(/[._]/g, ' ')
}
