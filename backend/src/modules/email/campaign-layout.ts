/**
 * Chrome-ul unei campanii bulk (banner + card centrat + footer) — injectat o singură dată aici,
 * server-side, la trimitere (`bulkSend`, `service.ts`). Corpul editat de Stefan (RichTextEditor,
 * TemplateFormDialog.tsx) rămâne text/formatare simplă — schema TipTap nu ține div/table/
 * background-uri, deci un banner cu gradient nu ar supraviețui unui roundtrip prin editor. Aici
 * nu trece deloc prin el, doar se randează direct în HTML-ul trimis prin Resend.
 *
 * 2026-08-11 — bug Stefan: fără card cu lățime limitată, conținutul se întindea pe toată
 * lățimea ferestrei pe desktop (pe mobil arăta ok, ecranul e oricum îngust). max-width:600px +
 * margin:0 auto e convenția standard pt. email — coloană centrată, indiferent de client.
 */

const BRAND_GRADIENT =
  'radial-gradient(circle at 15% 25%, rgba(255,255,255,0.16) 0%, transparent 45%), ' +
  'radial-gradient(circle at 85% 75%, rgba(255,255,255,0.14) 0%, transparent 50%), ' +
  'linear-gradient(135deg, #024397 0%, #046ffb 100%)'

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function wrapBulkCampaignHtml(bodyInnerHtml: string, unsubscribeHtml: string, companyName: string): string {
  const name = escapeHtml(companyName)
  return `<div style="background:#f1f5f9;padding:32px 16px">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
    <div style="background:${BRAND_GRADIENT};padding:32px 24px;text-align:center">
      <span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase">${name}</span>
    </div>
    <div style="padding:32px 28px">${bodyInnerHtml}</div>
    <div style="background:#f8fafc;padding:20px 24px;text-align:center;border-top:1px solid #e2e8f0">
      ${unsubscribeHtml}
      <p style="margin:12px 0 0;color:#94a3b8;font-size:12px">${name}</p>
    </div>
  </div>
</div>`
}
