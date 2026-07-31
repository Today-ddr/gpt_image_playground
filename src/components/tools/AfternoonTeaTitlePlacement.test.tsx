import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AfternoonTeaItem } from '../../types'
import { AfternoonTeaItemPlacement } from './AfternoonTeaTitlePlacement'

const items: AfternoonTeaItem[] = [
  { displayName: '蟹肉沙拉紫菜包饭', tags: [] },
  { displayName: '金枪鱼紫菜包饭', tags: [] },
]

describe('AfternoonTeaTitlePlacement compatibility export', () => {
  it('renders all order product labels in the shared natural-ratio stage', () => {
    const html = renderToStaticMarkup(<AfternoonTeaItemPlacement
      imageSrc="data:image/png;base64,AQID"
      items={items}
      regions={[
        { x: 0.1, y: 0.1, width: 0.3, height: 0.2 },
        { x: 0.55, y: 0.6, width: 0.3, height: 0.2 },
      ]}
      locked={false}
      onChange={() => {}}
    />)

    expect((html.match(/data-item-title-box=/g) ?? [])).toHaveLength(2)
    expect(html).toContain('蟹肉沙拉紫菜包饭')
    expect(html).toContain('金枪鱼紫菜包饭')
    expect(html).toContain('touch-action:none')
  })
})
