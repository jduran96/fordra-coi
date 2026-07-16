import sanitizeHtml from 'sanitize-html'

/**
 * Server-side sanitization for the rich-text contact-note summary. The admin
 * editor (RichTextInput) only produces bold/italic/underline paragraphs, but
 * the HTML crosses a form boundary, so the save action re-sanitizes with a
 * strict allowlist before anything is stored. Everything downstream
 * (dangerouslySetInnerHTML on /admin and /app) renders only what passed here.
 */

const ALLOWED_TAGS = ['p', 'br', 'strong', 'b', 'em', 'i', 'u']

export function sanitizeSummaryHtml(html: string): string {
  const clean = sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {},
    disallowedTagsMode: 'discard',
  }).trim()
  // An "empty" editor can still emit <p></p>; treat markup with no text as no summary.
  return summaryPlainText(clean) ? clean : ''
}

/**
 * Plain-text derivation of the summary for the PDF and legacy-style fallbacks:
 * paragraph/line breaks become newlines, tags drop, entities decode.
 */
export function summaryPlainText(html: string): string {
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n')
  const text = sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} })
  return text
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .split('\n').map(l => l.trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
