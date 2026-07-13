import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { JsonTree } from './JsonTree'
import { MediaContentPreview } from './MediaContentPreview'

describe('MediaContentPreview', () => {
  it('renders compact accessible generated-image facts without expandable JSON', () => {
    const descriptor = {
      kind: 'image',
      mediaType: 'image/png',
      sizeBytes: 2048,
      width: 640,
      height: 480,
      digestPrefix: 'abcdef123456',
      sourceCategory: 'data',
    } as const
    const html = renderToStaticMarkup(<MediaContentPreview descriptor={descriptor} label="generated" />)

    expect(html).toContain('aria-label="generated: Image, image/png, 2 KB, 640 by 480 pixels, digest abcdef123456"')
    expect(html).toContain('Image')
    expect(html).toContain('640×480')
    expect(html).not.toContain('sourceCategory')
  })

  it('dispatches transcription media descriptors away from the generic JSON tree', () => {
    const html = renderToStaticMarkup(
      <JsonTree data={{ kind: 'file', mediaType: 'audio/mpeg', durationSeconds: 12.5, sourceCategory: 'url' }} />,
    )

    expect(html).toContain('File')
    expect(html).toContain('12.5s')
    expect(html).not.toContain('sourceCategory')
    expect(html).not.toContain('{')
  })
})
