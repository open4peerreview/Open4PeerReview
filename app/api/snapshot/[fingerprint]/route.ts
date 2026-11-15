import { NextRequest, NextResponse } from 'next/server'
import { readH5pIntegration, type H5pActivity } from '@/lib/h5p'
import { createClient } from '@/lib/supabase/server'
import { detectPlatform, detectPlatformFromHtml, isValidOerUrl } from '@/lib/oer-platform'

// Origin used when a snapshot is served without a ?src= hint (legacy snapshots).
const DEFAULT_ORIGIN = 'https://openstax.org'

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

function rewriteHtml(html: string, origin: string, platform: string, sourceUrl: string): string {
  // Strip all <script> tags — OER platforms (OpenStax's React app, Pressbooks'
  // WordPress front-end) boot and hydrate over the SSR content, rendering blank
  // or misbehaving in an iframe context. The SSR'd HTML already contains the
  // full readable content; no JS needed.
  const activities: Record<string, H5pActivity> = {}
  let out = html.replace(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi, (_tag, script: string) => {
    Object.assign(activities, readH5pIntegration(script, sourceUrl, platform === 'Pressbooks'))
    return ''
  })
  const h5p = JSON.stringify({ sourceUrl, pressbooks: platform === 'Pressbooks', activities })
    .replace(/</g, '\\u003c')
  const h5pMetadata = `<script type="application/json" id="o4pr-h5p-metadata" data-open4pr="h5p">${h5p}</script>`

  // Inject <base> tag so relative URLs for CSS/images resolve against the
  // snapshot's own origin (varies per book on Pressbooks).
  const baseTag = `<base href="${origin}/">`
  const navCss = navDisableStyle(platform)
  if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/<head[^>]*>/i, head => `${head}\n  ${baseTag}\n  ${navCss}\n  ${h5pMetadata}`)
  } else {
    out = baseTag + navCss + h5pMetadata + out
  }

  return out
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fingerprint: string }> }
) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const { fingerprint } = await params

  if (!/^[0-9a-f]{64}$/.test(fingerprint)) {
    return new NextResponse('Invalid fingerprint', { status: 400 })
  }

  // Resolve the snapshot's origin + platform from the ?src= hint the viewer
  // passes (the document's source_url). Falls back to OpenStax for legacy
  // snapshots saved before src threading existed.
  let origin = DEFAULT_ORIGIN
  let platform = 'OpenStax'
  const src = req.nextUrl.searchParams.get('src')
  if (src && isValidOerUrl(src)) {
    try {
      origin = new URL(src).origin
      platform = detectPlatform(src)
    } catch {
      // keep defaults
    }
  }

  // supabase.storage.download() uses getSession() internally, which reads the local cookie.
  // If the access token in the cookie is stale (expired between the getUser() refresh and this call),
  // Supabase storage returns 400. Using createSignedUrl (a POST) is immune to this because the
  // token is embedded in the URL, bypassing the Authorization-header path entirely.
  const { data: signedData, error: signError } = await supabase.storage
    .from('openstax-snapshots')
    .createSignedUrl(`${fingerprint}.html`, 60)

  if (signError || !signedData?.signedUrl) {
    return new NextResponse(
      `<!doctype html><html><head><title>Snapshot not found</title></head><body data-snapshot-error="not-found"></body></html>`,
      { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  }

  const fileRes = await fetch(signedData.signedUrl)
  if (!fileRes.ok) {
    return new NextResponse(
      `<!doctype html><html><head><title>Snapshot not found</title></head><body data-snapshot-error="not-found"></body></html>`,
      { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  }

  const html = await fileRes.text()
  // Custom-domain Pressbooks isn't recognised by hostname; sniff the markup for nav rules.
  if (platform === 'Other') platform = detectPlatformFromHtml(html) ?? platform
  const rewritten = rewriteHtml(html, origin, platform, src && isValidOerUrl(src) ? src : origin)

  return new NextResponse(rewritten, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Allow framing only from our own origin
      'Content-Security-Policy': "frame-ancestors 'self'",
      // Explicitly no X-Frame-Options so browsers allow the iframe
      'Cache-Control': 'private, max-age=3600',
    },
  })
}
