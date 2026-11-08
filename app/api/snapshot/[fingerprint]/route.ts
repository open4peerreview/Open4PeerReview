import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { detectPlatform, detectPlatformFromHtml, isValidOerUrl } from '@/lib/oer-platform'
import { rewriteHtml } from '@/lib/snapshot-rewrite'

// Origin used when a snapshot is served without a ?src= hint (legacy snapshots).
const DEFAULT_ORIGIN = 'https://openstax.org'

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
  const rewritten = rewriteHtml(html, origin, platform, src && isValidOerUrl(src) ? src : undefined)

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
