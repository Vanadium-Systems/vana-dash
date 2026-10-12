// Paletă categorică comună (skill `dataviz`, validată cu scripts/validate_palette.js —
// 6 sloturi, toate verificările adjacent PASS în light: CVD ΔE 9.1, normal-vision ΔE 19.6).
// Ordine FIXĂ, niciodată reordonată/ciclată per pagină — un consumator ia primele N sloturi
// de care are nevoie, nu inventează hex nou (ReportsPage, EventFormDialog, WeekView, MonthView
// foloseau anterior 4 seturi hardcodate diferite, inclusiv un verde aproape identic cu
// --primary). Contrast sub 3:1 pe 3 din cele 6 (regula de "relief") — folosite doar acolo unde
// eticheta e deja vizibilă direct (legendă/titlu eveniment), nu doar culoarea.
export const CHART_COLORS = [
  '#2a78d6', // blue
  '#eb6834', // orange
  '#1baf7a', // aqua
  '#eda100', // yellow
  '#e87ba4', // magenta
  '#008300', // green
] as const

// Gri neutru pt. categorii "altele"/necunoscute — distinct de toate sloturile de mai sus,
// nu face parte din setul categoric (nu se reordonează, nu se ciclează).
export const CHART_NEUTRAL = '#94a3b8'

export function chartColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length] ?? CHART_NEUTRAL
}
