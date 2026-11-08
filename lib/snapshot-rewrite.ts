import { tokens } from '@/lib/design-system/token-values'

// Per-platform CSS that disables in-content navigation links, so a reviewer
// can't click out of the snapshot into the live site inside the iframe.
// Selectors are additive — each platform's chapter/page-nav markup differs.
const NAV_DISABLE_RULES: Record<string, string> = {
  // OpenStax book-page links (Next/Previous chapter) all match /books/…/pages/…
  OpenStax: `
  a[href^="/books"],
  a[href*="openstax.org/books"],
  a[href^="/l/"],
  .os-raise-nav a,
  .os-raise-nav-btn,
  nav[data-type="chapter-nav"] a,
  [data-type="next-page"],
  [data-type="prev-page"]`,
  // Pressbooks (WordPress-based) reader navigation. Verified against the live
  // Pressbooks reader theme: prev/next chapter links live in <nav class="nav-reading">,
  // and the chapter table-of-contents dropdown uses .reading-header__toc /
  // .block-reading-toc. rel/aria selectors are kept as defensive fallbacks.
  Pressbooks: `
  .nav-reading a,
  .reading-header__toc a,
  .block-reading-toc a,
  a[rel="next"],
  a[rel="prev"],
  a[rel="prev-chapter"],
  a[rel="next-chapter"]`,
}

function navDisableStyle(platform: string): string {
  const rules = NAV_DISABLE_RULES[platform] ?? NAV_DISABLE_RULES.OpenStax
  return `<style data-open4pr="nav-disable">
${rules} {
    pointer-events: none !important;
    cursor: not-allowed !important;
    opacity: 0.45 !important;
  }
</style>`
}

export function rewriteHtml(html: string, origin: string, platform: string, sourceUrl?: string): string {
  // Strip all <script> tags — OER platforms (OpenStax's React app, Pressbooks'
  // WordPress front-end) boot and hydrate over the SSR content, rendering blank
  // or misbehaving in an iframe context. The SSR'd HTML already contains the
  // full readable content; no JS needed.
  let out = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')

  // Inject <base> tag so relative URLs for CSS/images resolve against the
  // snapshot's own origin (varies per book on Pressbooks).
  out = replaceH5pEmbeds(out, origin, sourceUrl ?? origin)

  const baseTag = `<base href="${origin}/">`
  const navCss = navDisableStyle(platform)
  if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/(<head[^>]*>)/i, `$1\n  ${baseTag}\n  ${navCss}`)
  } else {
    out = baseTag + navCss + out
  }

  return out
}

// ── H5P embeds ──────────────────────────────────────────────────────────────
// H5P interactives need JavaScript, but the snapshot is shown in a sandboxed
// iframe without allow-scripts (and sandbox flags are inherited by nested
// frames), so they render as blank boxes. We can't safely allow scripts on a
// same-origin snapshot, so each H5P iframe becomes a placeholder that links to
// the live interactive.

const IFRAME_RE = /<iframe\b[^>]*>(?:[\s\S]*?<\/iframe>)?/gi

function getAttr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : null
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** Resolve to an absolute http(s) URL, or null (rejects javascript:, data:, about:blank, …). */
function safeHttpUrl(raw: string | null, origin: string): string | null {
  if (!raw) return null
  try {
    const u = new URL(raw.trim(), origin + '/')
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null
  } catch {
    return null
  }
}

export function isH5pIframe(tag: string): boolean {
  const src = getAttr(tag, 'src') ?? ''
  const cls = getAttr(tag, 'class') ?? ''
  return /h5p/i.test(src) || /\bh5p-iframe\b/i.test(cls) || getAttr(tag, 'data-content-id') !== null
}

function h5pPlaceholder(tag: string, origin: string, fallbackUrl: string): string {
  const id = getAttr(tag, 'data-content-id')
  const href =
    safeHttpUrl(getAttr(tag, 'src'), origin) ??
    (id && /^\d+$/.test(id) ? `${origin}/wp-admin/admin-ajax.php?action=h5p_embed&id=${id}` : null) ??
    safeHttpUrl(fallbackUrl, origin) ??
    origin
  const c = tokens.color
  return `<div data-open4pr="h5p-placeholder" style="box-sizing:border-box;margin:16px 0;padding:24px;text-align:center;background:${c.surfaceWarm};border:1px solid ${c.border};border-radius:8px;color:${c.textPrimary};font-family:${tokens.font.body}">
  <p style="margin:0 0 4px;font-weight:700">Interactive H5P content</p>
  <p style="margin:0 0 12px;font-size:14px;color:${c.textSecondary}">This interactive can't run inside the review snapshot.</p>
  <a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" style="color:${c.primary};font-weight:700;text-decoration:underline">Open interactive in a new tab</a>
</div>`
}

function replaceH5pEmbeds(html: string, origin: string, fallbackUrl: string): string {
  return html.replace(IFRAME_RE, full => {
    const tag = /^<iframe\b[^>]*>/i.exec(full)?.[0] ?? full // attributes live on the opening tag only
    return isH5pIframe(tag) ? h5pPlaceholder(tag, origin, fallbackUrl) : full
  })
}
