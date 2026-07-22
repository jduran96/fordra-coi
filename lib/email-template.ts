/**
 * Fordra shell for notification emails: cream page, icon + wordmark header,
 * white card with a lime accent rule, ink pill CTA, muted footer. Email-safe
 * by construction — tables, all styles inline, hex colors only (the theme's
 * oklch status colors do not survive email clients), no webfonts (Georgia
 * serif stack for the wordmark, system sans for body, matching the theme's
 * fallback chains). The mark is a committed PNG (public/email/fordra-mark.png,
 * 2x of the 34px render) because email clients strip inline SVG; Gmail hides
 * remote images until "show images", so the alt text keeps the header legible.
 *
 * Callers pass bodyHtml ALREADY ESCAPED (lib/notify.ts esc()) and keep their
 * owner-approved sentences verbatim; this file only adds the visual shell.
 */

// Hex equivalents of lib/theme.ts tokens (C.border is rgba — flattened over
// the white card to #e3e1da).
const PAPER = '#faf9f5'
const INK = '#141413'
const LIME = '#d4fd8e'
const BORDER = '#e3e1da'
const MUTED = '#7e7e7e'
const SANS = "-apple-system,'Segoe UI',Helvetica,Arial,sans-serif"
const SERIF = "Georgia,'Times New Roman',serif"

function markUrl(): string {
  const base = process.env.NEXT_PUBLIC_BASE_URL || 'https://app.fordra.com'
  return `${base}/email/fordra-mark.png`
}

export function emailShell({ bodyHtml, ctaLabel, ctaUrl }: {
  /** Pre-escaped HTML paragraphs; rendered verbatim inside the card. */
  bodyHtml: string
  ctaLabel: string
  /** Pre-escaped URL for the pill button. */
  ctaUrl: string
}): string {
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:${PAPER};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};">
<tr><td align="center" style="padding:36px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
<tr><td style="padding:0 6px 18px;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="vertical-align:middle;"><img src="${markUrl()}" width="34" height="34" alt="Fordra" style="display:block;border:0;border-radius:8px;" /></td>
<td style="vertical-align:middle;padding-left:10px;font-family:${SERIF};font-size:23px;color:${INK};letter-spacing:-0.4px;">Fordra</td>
</tr></table>
</td></tr>
<tr><td style="background:#ffffff;border:1px solid ${BORDER};border-top:3px solid ${LIME};border-radius:12px;padding:30px 34px;">
<div style="font-family:${SANS};font-size:15px;line-height:1.65;color:${INK};">
${bodyHtml}
</div>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:22px;"><tr>
<td style="border-radius:9999px;background:${INK};">
<a href="${ctaUrl}" style="display:inline-block;padding:11px 26px;font-family:${SANS};font-size:14px;font-weight:600;color:${PAPER};text-decoration:none;border-radius:9999px;">${ctaLabel}</a>
</td>
</tr></table>
</td></tr>
<tr><td style="padding:18px 6px 0;font-family:${SANS};font-size:12px;color:${MUTED};">
Fordra &middot; app.fordra.com
</td></tr>
</table>
</td></tr>
</table>
</body></html>`
}
