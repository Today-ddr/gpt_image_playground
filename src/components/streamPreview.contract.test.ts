import { describe, expect, it } from 'vitest'
import detailModalSource from './DetailModal.tsx?raw'
import taskCardSource from './TaskCard.tsx?raw'
import hookSource from '../hooks/useImageLoadState.ts?raw'

describe('stream preview load handling', () => {
  it('uses the shared load hook and keeps preview images in layout until decoded', () => {
    expect(hookSource).toContain('img.complete && img.naturalWidth > 0')
    expect(taskCardSource).toContain('useImageLoadState')
    expect(detailModalSource).toContain('useImageLoadState')
    expect(taskCardSource).toContain('opacity-0')
    expect(detailModalSource).toContain('opacity-0')
    expect(taskCardSource).not.toContain("streamPreviewLoaded ? '' : 'hidden'")
    expect(detailModalSource).not.toContain("streamPreviewLoaded ? '' : 'hidden'")
  })
})
