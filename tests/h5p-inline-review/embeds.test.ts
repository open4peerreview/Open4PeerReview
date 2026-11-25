import { describe, expect, it } from 'vitest'
import { h5pEmbedUrl, readH5pIntegration } from '@/lib/h5p'

const chapter = 'https://open.maricopa.edu/com225/h5p-listing/'
const player = 'https://open.maricopa.edu/com225/wp-admin/admin-ajax.php?action=h5p_embed&id=4'

describe('publisher H5P embed metadata', () => {
  it('keeps the book path from Pressbooks, including a relative embed URL', () => {
    const script = `H5PIntegration = ${JSON.stringify({ contents: {
      'cid-4': { title: 'Persuasive Speaking', url: '../wp-admin/admin-ajax.php?action=h5p_embed&id=4' },
    } })};`
    expect(readH5pIntegration(script, chapter, true)).toEqual({
      '4': { url: player, title: 'Persuasive Speaking' },
    })
  })

  it('ignores disabled embeds and executable integration expressions', () => {
    expect(readH5pIntegration(`H5PIntegration = ${JSON.stringify({ contents: {
      'cid-4': { url: player, displayOptions: { embed: false } },
    } })};`, chapter, true)).toEqual({})
    expect(readH5pIntegration('H5PIntegration = createIntegration();', chapter, true)).toEqual({})
  })

  it('accepts direct hosted H5P players', () => {
    expect(h5pEmbedUrl('https://h5p.org/h5p/embed/617', chapter)).toBe('https://h5p.org/h5p/embed/617')
    expect(h5pEmbedUrl('https://example.h5p.com/content/123/embed', chapter)).toBe('https://example.h5p.com/content/123/embed')
  })

  it.each([
    'about:blank',
    'data:text/html,placeholder',
    'http://open.maricopa.edu/h5p/embed/4',
    'https://localhost/h5p/embed/4',
    'https://example.com/wp-admin/admin-ajax.php?action=h5p_embed&id=4',
    'https://open.maricopa.edu/com225/wp-admin/admin-ajax.php?action=other&id=4',
    'https://open.maricopa.edu/com225/chapter/introduction/',
  ])('does not treat %s as a player', url => {
    expect(h5pEmbedUrl(url, chapter, true)).toBeNull()
  })
})
