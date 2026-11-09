import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getUser, maybeSingle, eq, createSignedUrl, from } = vi.hoisted(() => {
  const getUser = vi.fn()
  const maybeSingle = vi.fn()
  const eq = vi.fn(() => ({ maybeSingle }))
  const createSignedUrl = vi.fn()
  const from = vi.fn(() => ({ select: () => ({ eq }) }))
  return { getUser, maybeSingle, eq, createSignedUrl, from }
})

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser },
    from,
    storage: { from: () => ({ createSignedUrl }) },
  }),
}))

import { GET } from '../[documentId]/resource/route'

const sourceUrl = 'https://open.maricopa.edu/book/chapter-1/?section=2#reading'
const signedUrl = 'https://storage.example/documents/file.pdf?token=fresh'
const documentId = '8f79f098-67e7-4f60-b347-d3ce08f89846'

function openResource() {
  return GET(new Request(`http://localhost/api/documents/${documentId}/resource`), {
    params: Promise.resolve({ documentId }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  getUser.mockResolvedValue({ data: { user: { id: 'reviewer-1' } } })
  maybeSingle.mockResolvedValue({
    data: { file_type: 'html', source_url: sourceUrl, file_url: 'https://legacy.example/', storage_path: 'snapshot.html' },
    error: null,
  })
  createSignedUrl.mockResolvedValue({ data: { signedUrl }, error: null })
})

describe('GET document resource', () => {
  it('opens the original web resource, preserving its path, query and fragment', async () => {
    const response = await openResource()
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(sourceUrl)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(from).toHaveBeenCalledWith('documents')
    expect(eq).toHaveBeenCalledWith('id', documentId)
    expect(createSignedUrl).not.toHaveBeenCalled()
  })

  it('supports legacy web submissions with only a file_url', async () => {
    maybeSingle.mockResolvedValue({ data: { file_type: 'html', file_url: sourceUrl }, error: null })
    expect((await openResource()).headers.get('location')).toBe(sourceUrl)
  })

  it.each(['pdf', 'image', 'audio'])('signs a stored %s on each click instead of reusing an expired URL', async fileType => {
    maybeSingle.mockResolvedValue({
      data: { file_type: fileType, storage_path: 'author-1/file', file_url: 'https://storage.example/expired' },
      error: null,
    })
    expect((await openResource()).headers.get('location')).toBe(signedUrl)
    const nextUrl = `${signedUrl}-next`
    createSignedUrl.mockResolvedValueOnce({ data: { signedUrl: nextUrl }, error: null })
    expect((await openResource()).headers.get('location')).toBe(nextUrl)
    expect(createSignedUrl).toHaveBeenCalledTimes(2)
    expect(createSignedUrl).toHaveBeenCalledWith('author-1/file', 3600)
  })

  it('requires authentication before reading or signing a resource', async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    expect((await openResource()).status).toBe(401)
    expect(from).not.toHaveBeenCalled()
    expect(createSignedUrl).not.toHaveBeenCalled()
  })

  it('does not sign resources hidden by document access policies', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null })
    expect((await openResource()).status).toBe(404)
    expect(createSignedUrl).not.toHaveBeenCalled()
  })

  it('reports a missing attachment without redirecting to the dashboard', async () => {
    maybeSingle.mockResolvedValue({ data: { file_type: 'pdf' }, error: null })
    const response = await openResource()
    expect(response.status).toBe(404)
    expect(response.headers.get('location')).toBeNull()
  })

  it.each(['javascript:alert(1)', 'https://localhost/', 'https://user:password@example.com/', 'not-a-url'])('rejects an invalid resource target: %s', async url => {
    maybeSingle.mockResolvedValue({ data: { file_type: 'html', source_url: url }, error: null })
    const response = await openResource()
    expect(response.status).toBe(400)
    expect(response.headers.get('location')).toBeNull()
  })

  it('does not expose database error details', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: new Error('private database details') })
    const response = await openResource()
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain('private database details')
  })

  it('reports a signing failure rather than opening the expired upload URL', async () => {
    maybeSingle.mockResolvedValue({
      data: { file_type: 'pdf', storage_path: 'file.pdf', file_url: 'https://storage.example/expired' },
      error: null,
    })
    createSignedUrl.mockResolvedValue({ data: null, error: new Error('storage failure') })
    const response = await openResource()
    expect(response.status).toBe(502)
    expect(response.headers.get('location')).toBeNull()
  })
})
