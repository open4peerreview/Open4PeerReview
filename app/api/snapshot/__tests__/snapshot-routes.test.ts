import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const fetchAndSnapshot = vi.fn()
const submitOpenStaxLink = vi.fn()
const updateDocumentContent = vi.fn()
const institutionRef: { value: string | null } = { value: 'Maricopa Community Colleges' }
const authedRef: { value: boolean } = { value: true }

const supabase = {
  auth: { getUser: async () => ({ data: { user: authedRef.value ? { id: 'user-1' } : null } }) },
  from: (table: string) => {
    if (table === 'users') {
      return { select: () => ({ eq: () => ({ single: async () => ({ data: { institution: institutionRef.value } }) }) }) }
    }
    if (table === 'documents') {
      return { select: () => ({ eq: () => ({ single: async () => ({ data: { author_id: 'user-1', is_draft: true } }) }) }) }
    }
    throw new Error(`unexpected table ${table}`)
  },
  storage: {
    from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'https://storage.example/signed' }, error: null }) }),
  },
}

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => supabase }))
vi.mock('@/lib/supabase/queries', () => ({
  submitOpenStaxLink: (...a: unknown[]) => submitOpenStaxLink(...a),
  updateDocumentContent: (...a: unknown[]) => updateDocumentContent(...a),
}))
vi.mock('@/lib/snapshot-utils', () => ({ fetchAndSnapshot: (...a: unknown[]) => fetchAndSnapshot(...a) }))

import { POST } from '../route'
import { POST as POST_PAGE } from '../page/route'
import { GET as GET_SNAPSHOT } from '../[fingerprint]/route'

const PRESSBOOKS_HTML = '<html><head><meta name="generator" content="Pressbooks 6.4"></head><body></body></html>'
const PLAIN_HTML = '<html><head><title>x</title></head><body>hi</body></html>'

function snapshotResult(html: string) {
  return { fingerprint: 'a'.repeat(64), storagePath: `${'a'.repeat(64)}.html`, html }
}

function post(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/snapshot', {
    method: 'POST',
    body: JSON.stringify({ title: 't', authors: 'a', subjectMatter: 's', ccLicense: 'CC-BY', ...body }),
  })
}

beforeEach(() => {
  fetchAndSnapshot.mockReset()
  submitOpenStaxLink.mockReset().mockResolvedValue({ id: 'doc-1' })
  updateDocumentContent.mockReset()
  institutionRef.value = 'Maricopa Community Colleges'
  authedRef.value = true
})

describe('POST /api/snapshot — validation', () => {
  it('requires authentication', async () => {
    authedRef.value = false
    expect((await POST(post({ url: 'https://open.maricopa.edu/book' }))).status).toBe(401)
  })

  it.each([
    'http://open.maricopa.edu/book',
    'https://169.254.169.254/latest/meta-data/',
    'https://localhost:3000/',
    'not-a-url',
  ])('rejects %s with 400 and never fetches', async url => {
    const res = await POST(post({ url }))
    expect(res.status).toBe(400)
    expect(fetchAndSnapshot).not.toHaveBeenCalled()
    expect(submitOpenStaxLink).not.toHaveBeenCalled()
  })

  it('rejects an invalid additional page URL before fetching anything', async () => {
    const res = await POST(post({ url: 'https://open.maricopa.edu/book', additionalPageUrls: ['https://10.0.0.1/x'] }))
    expect(res.status).toBe(400)
    expect(fetchAndSnapshot).not.toHaveBeenCalled()
  })

  it('surfaces fetch errors from the snapshotter', async () => {
    fetchAndSnapshot.mockResolvedValueOnce({ error: 'Could not reach URL', status: 502 })
    expect((await POST(post({ url: 'https://open.maricopa.edu/book' }))).status).toBe(502)
  })
})

describe('POST /api/snapshot — platform labelling', () => {
  it('labels a custom-domain Pressbooks book with the submitter institution', async () => {
    fetchAndSnapshot.mockResolvedValueOnce(snapshotResult(PRESSBOOKS_HTML))
    const res = await POST(post({ url: 'https://open.maricopa.edu/book' }))
    expect(res.status).toBe(200)
    expect(submitOpenStaxLink.mock.calls[0][1].platform).toBe('Pressbooks (Maricopa Community Colleges)')
  })

  it('labels hosted Pressbooks (pressbooks.pub) with the institution too', async () => {
    fetchAndSnapshot.mockResolvedValueOnce(snapshotResult(PLAIN_HTML))
    await POST(post({ url: 'https://slcc.pressbooks.pub/book' }))
    expect(submitOpenStaxLink.mock.calls[0][1].platform).toBe('Pressbooks (Maricopa Community Colleges)')
  })

  it('falls back to plain "Pressbooks" when the submitter has no institution', async () => {
    institutionRef.value = null
    fetchAndSnapshot.mockResolvedValueOnce(snapshotResult(PRESSBOOKS_HTML))
    await POST(post({ url: 'https://open.maricopa.edu/book' }))
    expect(submitOpenStaxLink.mock.calls[0][1].platform).toBe('Pressbooks')
  })

  it('labels an unknown, non-Pressbooks domain "Other"', async () => {
    fetchAndSnapshot.mockResolvedValueOnce(snapshotResult(PLAIN_HTML))
    await POST(post({ url: 'https://oer.somecollege.edu/course' }))
    expect(submitOpenStaxLink.mock.calls[0][1].platform).toBe('Other')
  })

  it('does not decorate OpenStax with the institution', async () => {
    fetchAndSnapshot.mockResolvedValueOnce(snapshotResult(PLAIN_HTML))
    await POST(post({ url: 'https://openstax.org/books/biology-2e/pages/1' }))
    expect(submitOpenStaxLink.mock.calls[0][1].platform).toBe('OpenStax')
  })

  it('uses the primary page, not an additional page, to decide the platform', async () => {
    fetchAndSnapshot
      .mockResolvedValueOnce(snapshotResult(PLAIN_HTML))
      .mockResolvedValueOnce(snapshotResult(PRESSBOOKS_HTML))
    await POST(post({ url: 'https://oer.somecollege.edu/a', additionalPageUrls: ['https://open.maricopa.edu/b'] }))
    expect(submitOpenStaxLink.mock.calls[0][1].platform).toBe('Other')
  })

  it('writes the same label when updating an existing draft', async () => {
    fetchAndSnapshot.mockResolvedValueOnce(snapshotResult(PRESSBOOKS_HTML))
    await POST(post({ url: 'https://open.maricopa.edu/book', documentId: 'doc-9' }))
    expect(updateDocumentContent).toHaveBeenCalledWith(
      expect.anything(),
      'doc-9',
      expect.objectContaining({ platform: 'Pressbooks (Maricopa Community Colleges)', sourceUrl: 'https://open.maricopa.edu/book' }),
    )
    expect(submitOpenStaxLink).not.toHaveBeenCalled()
  })
})

describe('POST /api/snapshot/page', () => {
  const req = (url: string) => new NextRequest('http://localhost/api/snapshot/page', { method: 'POST', body: JSON.stringify({ url }) })

  it('accepts a custom-domain page', async () => {
    fetchAndSnapshot.mockResolvedValueOnce(snapshotResult(PLAIN_HTML))
    const res = await POST_PAGE(req('https://open.maricopa.edu/book/ch2'))
    expect(res.status).toBe(200)
    expect((await res.json()).fingerprint).toBe('a'.repeat(64))
  })

  it('rejects private targets', async () => {
    const res = await POST_PAGE(req('https://192.168.1.10/admin'))
    expect(res.status).toBe(400)
    expect(fetchAndSnapshot).not.toHaveBeenCalled()
  })
})

describe('GET /api/snapshot/[fingerprint] — nav rules & base origin', () => {
  const fp = 'b'.repeat(64)
  const getReq = (src?: string) =>
    new NextRequest(`http://localhost/api/snapshot/${fp}${src ? `?src=${encodeURIComponent(src)}` : ''}`)
  const call = (src?: string) => GET_SNAPSHOT(getReq(src), { params: Promise.resolve({ fingerprint: fp }) })

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })
  const serve = (html: string) => (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(html, { status: 200 }))

  it('applies Pressbooks nav rules to a custom-domain Pressbooks snapshot and uses its origin as <base>', async () => {
    serve(PRESSBOOKS_HTML)
    const html = await (await call('https://open.maricopa.edu/book/ch1')).text()
    expect(html).toContain('<base href="https://open.maricopa.edu/">')
    expect(html).toContain('.nav-reading a')
  })

  it('falls back to OpenStax nav rules for an unknown non-Pressbooks site', async () => {
    serve(PLAIN_HTML)
    const html = await (await call('https://oer.somecollege.edu/x')).text()
    expect(html).toContain('<base href="https://oer.somecollege.edu/">')
    expect(html).not.toContain('.nav-reading a')
    expect(html).toContain('data-type="next-page"')
  })

  it('strips scripts from the snapshot', async () => {
    serve('<html><head><script>alert(1)</script></head><body></body></html>')
    expect(await (await call('https://open.maricopa.edu/')).text()).not.toContain('alert(1)')
  })

  it('keeps Maricopa’s declared H5P player URL without a generator tag', async () => {
    const source = 'https://open.maricopa.edu/com225/h5p-listing/'
    const url = 'https://open.maricopa.edu/com225/wp-admin/admin-ajax.php?action=h5p_embed&id=4'
    const integration = JSON.stringify({ contents: { 'cid-4': { url, title: 'Speaking $& <activity>' } } })
    serve(`<html><head><link rel="stylesheet" href="https://open.maricopa.edu/app/themes/pressbooks-book/assets/dist/assets/book-CIDUA1kK.css">
      <script>H5PIntegration = ${integration};</script><script src="/runtime.js"></script>
      </head><body><iframe src="about:blank" data-content-id="4"></iframe></body></html>`)
    const response = await call(source)
    const html = await response.text()
    const metadata = /<script type="application\/json" id="o4pr-h5p-metadata" data-open4pr="h5p">([^<]+)<\/script>/.exec(html)
    expect(metadata).not.toBeNull()
    expect(JSON.parse(metadata![1])).toEqual({
      sourceUrl: source,
      pressbooks: true,
      activities: { '4': { url, title: 'Speaking $& <activity>' } },
    })
    expect(html).not.toContain('H5PIntegration =')
    expect(html).not.toContain('/runtime.js')
    expect(response.headers.get('content-security-policy')).toBe("frame-ancestors 'self'")
  })

  it('ignores an invalid ?src= and uses the legacy OpenStax origin', async () => {
    serve(PLAIN_HTML)
    const html = await (await call('https://127.0.0.1/evil')).text()
    expect(html).toContain('<base href="https://openstax.org/">')
    expect(html).not.toContain('127.0.0.1')
  })

  it('rejects a malformed fingerprint', async () => {
    const res = await GET_SNAPSHOT(getReq(), { params: Promise.resolve({ fingerprint: '../etc/passwd' }) })
    expect(res.status).toBe(400)
  })
})
