import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSignedUrl } from '@/lib/supabase/queries'
import { isValidOerUrl } from '@/lib/oer-platform'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Please sign in to open this resource.' }, { status: 401 })

  const { documentId } = await params
  // Use the current user's client so document and storage access still follow RLS.
  const { data: document, error } = await supabase
    .from('documents')
    .select('file_type, source_url, file_url, storage_path')
    .eq('id', documentId)
    .maybeSingle()

  if (error) return NextResponse.json({ error: 'Unable to load this resource.' }, { status: 500 })
  if (!document) return NextResponse.json({ error: 'Resource not found.' }, { status: 404 })

  let url = document.source_url || document.file_url
  if (document.file_type !== 'html' && document.storage_path) {
    try {
      // Stored upload URLs expire; generate a fresh one on each click.
      url = await getSignedUrl(supabase, document.storage_path)
    } catch {
      return NextResponse.json({ error: 'Unable to open this file. Please try again.' }, { status: 502 })
    }
  } else if (url && !isValidOerUrl(url)) {
    return NextResponse.json({ error: 'This resource does not have a valid public HTTPS URL.' }, { status: 400 })
  }

  if (!url) return NextResponse.json({ error: 'No resource has been attached to this submission yet.' }, { status: 404 })

  return NextResponse.redirect(url, { headers: { 'Cache-Control': 'private, no-store' } })
}
