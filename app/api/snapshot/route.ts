import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { submitOpenStaxLink, updateDocumentContent } from '@/lib/supabase/queries'
import { detectPlatform, detectPlatformFromHtml, isValidOerUrl, platformLabel } from '@/lib/oer-platform'
import { fetchAndSnapshot } from '@/lib/snapshot-utils'

export async function POST(req: NextRequest) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: {
    url: string
    title: string
    authors: string
    subjectMatter: string
    ccLicense: string
    thirdPartyDisclosure?: string
    rubricIds?: string[]
    submissionScope?: string[]
    isDraft?: boolean
    coordinatorUpload?: boolean
    publicReview?: boolean
    documentId?: string
    additionalPageUrls?: string[]
  }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { url, title, authors, subjectMatter, ccLicense, thirdPartyDisclosure, rubricIds, submissionScope, isDraft, coordinatorUpload, publicReview, documentId, additionalPageUrls } = body

  if (!url || !isValidOerUrl(url)) {
    return NextResponse.json(
      { error: 'URL must be a valid public https link.' },
      { status: 400 }
    )
  }

  const validAdditionalUrls = (additionalPageUrls ?? []).filter(u => u.trim())
  for (const pageUrl of validAdditionalUrls) {
    if (!isValidOerUrl(pageUrl)) {
      return NextResponse.json(
        { error: `Additional page URL is not a valid public https link: ${pageUrl}` },
        { status: 400 }
      )
    }
  }

  // Snapshot primary page
  const primary = await fetchAndSnapshot(supabase, url)
  if ('error' in primary) return NextResponse.json({ error: primary.error }, { status: primary.status })
  const { fingerprint, storagePath } = primary

  // Known host first; otherwise sniff the page (Pressbooks on a custom domain); else "Other".
  const basePlat = detectPlatform(url) !== 'Other' ? detectPlatform(url) : (detectPlatformFromHtml(primary.html) ?? 'Other')
  const { data: submitter } = await supabase.from('users').select('institution').eq('id', user.id).single()
  const platform = platformLabel(basePlat, submitter?.institution)

  // Snapshot additional pages in parallel: whole-chapter submissions can have 10–30 pages, and
  // doing them one by one (fetch + storage upload) took ~0.7s per page.
  const results = await Promise.all(validAdditionalUrls.map(pageUrl => fetchAndSnapshot(supabase, pageUrl)))
  const additionalPages: Array<{ url: string; fingerprint: string; storagePath: string }> = []
  for (const [i, result] of results.entries()) {
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })
    additionalPages.push({ url: validAdditionalUrls[i], fingerprint: result.fingerprint, storagePath: result.storagePath })
  }

  try {
    // Update mode: patch content on an existing document
    if (documentId) {
      const { data: doc } = await supabase
        .from('documents')
        .select('author_id, is_draft')
        .eq('id', documentId)
        .single()

      if (!doc || doc.author_id !== user.id) {
        return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
      }
      if (!doc.is_draft) {
        return NextResponse.json({ error: 'Only drafts can be updated' }, { status: 400 })
      }

      await updateDocumentContent(supabase, documentId, {
        fileType: 'html',
        fileUrl: url,
        storagePath,
        sourceUrl: url,
        contentFingerprint: fingerprint,
        platform,
      })

      return NextResponse.json({ documentId, fingerprint })
    }

    // Create mode: insert new document
    const doc = await submitOpenStaxLink(supabase, {
      url,
      storagePath,
      fingerprint,
      title,
      authors,
      subjectMatter,
      ccLicense: ccLicense as Parameters<typeof submitOpenStaxLink>[1]['ccLicense'],
      thirdPartyDisclosure: thirdPartyDisclosure ?? null,
      rubricIds: rubricIds ?? [],
      platform,
      submissionScope: submissionScope ?? ['public'],
      isDraft: isDraft ?? false,
      coordinatorUpload: coordinatorUpload ?? false,
      publicReview: publicReview ?? false,
      additionalPages: additionalPages.length ? additionalPages : undefined,
    })
    return NextResponse.json({ documentId: doc.id, fingerprint })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to save document' },
      { status: 500 }
    )
  }
}
