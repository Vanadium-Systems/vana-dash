// Numărul de evidență a plății (câmp `nr_evid`, D301) — format fix C(23) cu formulă de control
// pe poziții, extrasă din structura_D301_20130327.pdf (pag. 2):
//   Poz.1-2:   "10"
//   Poz.3-5:   "301"                (nomenclator declarație)
//   Poz.6-7:   "01"
//   Poz.8-11:  LLAA                 (perioada de raportare — luna+an, ultimele 2 cifre din an)
//   Poz.12-17: ZZLLAA               (scadența plății — 25 ale lunii următoare perioadei)
//   Poz.18:    0 dacă mijl_trans=0, 1 dacă mijl_trans=1
//   Poz.19-21: "000"
//   Poz.22-23: sumă de control — suma cifrelor de la poziția 1 la 21, ultimele 2 cifre

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Prima zi lucrătoare de referință pt. termenul de plată — D301 are termen fix 25, fără mutare
 * la zi lucrătoare (spre deosebire de alte declarații), conform structurii PDF. */
function dueDate(periodYear: number, periodMonth: number): { day: number; month: number; year: number } {
  const due = periodMonth === 12 ? { month: 1, year: periodYear + 1 } : { month: periodMonth + 1, year: periodYear }
  return { day: 25, month: due.month, year: due.year }
}

export function buildNrEvid(period: string, mijlTrans: boolean): string {
  const [yearStr, monthStr] = period.split('-')
  const year = Number(yearStr)
  const month = Number(monthStr)
  const due = dueDate(year, month)

  const p1to7 = `1030101`
  const p8to11 = `${pad2(month)}${pad2(year % 100)}`
  const p12to17 = `${pad2(due.day)}${pad2(due.month)}${pad2(due.year % 100)}`
  const p18 = mijlTrans ? '1' : '0'
  const p19to21 = '000'

  const first21 = `${p1to7}${p8to11}${p12to17}${p18}${p19to21}`
  const controlSum = first21.split('').reduce((sum, ch) => sum + Number(ch), 0)
  const p22to23 = pad2(controlSum % 100)

  return `${first21}${p22to23}`
}
