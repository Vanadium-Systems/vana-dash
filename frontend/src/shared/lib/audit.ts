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
  'client.creat': 'client creat',
  'client.modificat': 'client modificat',
  'factura.emitata': 'factură emisă',
  'factura.trimisa.anaf': 'factură trimisă la ANAF',
  'acces.rol.creat': 'rol creat',
  'acces.rol.redenumit': 'rol redenumit',
  'acces.rol.sters': 'rol șters',
  'acces.rol.functionalitate.activata': 'funcționalitate pornită',
  'acces.rol.functionalitate.oprita': 'funcționalitate oprită',
  'acces.rol.pagina.activata': 'pagină pornită',
  'acces.rol.pagina.oprita': 'pagină oprită',
  'echipa.invitare': 'invitație trimisă',
  'echipa.invitatie.acceptata': 'invitație acceptată',
  'echipa.invitare.retrimisa': 'invitație retrimisă',
  'echipa.cutii.schimbate': 'cutii de email schimbate',
  'echipa.dezactivare': 'om dezactivat',
  'echipa.actualizare': 'om modificat',
  'echipa.parola.resetare': 'parolă resetată',
  'parola.resetata': 'parolă resetată',
  'parola.schimbata': 'parolă schimbată',
  'contract.anexa.creata': 'anexă creată',
  'contract.pdf.semnat.incarcat': 'PDF semnat încărcat',
  'contract.semnat': 'contract semnat',
  'contract.semnatura.anulata': 'semnătură anulată',
  'contract.termeni.modificati': 'termeni modificați',
  'contract.numere-rezervate.modificate': 'numere rezervate modificate',
  'reconciliere.potrivire.manuala': 'potrivire manuală',
}

/** Acțiune necunoscută (de după acest fișier) → codul ei, ca text lizibil, nu un `undefined`. */
export function actionLabel(action: string): string {
  return ACTION_LABEL[action] ?? action.replace(/[._]/g, ' ')
}
