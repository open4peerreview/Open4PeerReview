import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isValidOerUrl } from '@/lib/oer-platform'
import { safeFetch } from '@/lib/url-safety'
import { parseOpenStaxToc, parsePressbooksToc, pressbooksBookRoot, type OerToc, type PressbooksToc } from '@/lib/oer-toc'

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; Open4PeerReview/1.0)',
  'Accept-Language': 'en-US,en;q=0.9',
}

/** OpenStax pages embed the book tree; any other site is tried as Pressbooks (works on custom domains). */
async function loadToc(url: string): Promise<OerToc | null> {
  const { hostname } = new URL(url)
  if (hostname === 'openstax.org' || hostname.endsWith('.openstax.org')) {
    const res = await safeFetch(url, { headers: { ...HEADERS, Accept: 'text/html' } })
    return res.ok ? parseOpenStaxToc(await res.text(), url) : null
  }

  const root = pressbooksBookRoot(url)
  const getJson = async (endpoint: string) => {
    const res = await safeFetch(`${root}wp-json/pressbooks/v2/${endpoint}`, { headers: { ...HEADERS, Accept: 'application/json' } })
    return res.ok && res.headers.get('content-type')?.includes('json') ? res.json() : null
  }
  const [toc, meta] = await Promise.all([getJson('toc'), getJson('metadata').catch(() => null)])
  return toc ? parsePressbooksToc(toc as PressbooksToc, meta?.name || hostname) : null
}

// GET /api/oer-toc?url=<any page of a book> → the book's chapters, for the submission chapter picker.
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = req.nextUrl.searchParams.get('url')?.trim() ?? ''
  if (!isValidOerUrl(url)) {
    return NextResponse.json({ error: 'URL must be a valid public https link.' }, { status: 400 })
  }

  try {
    const toc = await loadToc(url)
    if (!toc) {
      return NextResponse.json(
        { error: "We couldn't find chapters for this site. Add pages one by one instead." },
        { status: 404 },
      )
    }
    return NextResponse.json(toc)
  } catch {
    return NextResponse.json({ error: "Couldn't reach this site. Check the URL and try again." }, { status: 502 })
  }
}
