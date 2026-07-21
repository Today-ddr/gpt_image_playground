import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  AfternoonTeaPosterStep,
  getAfternoonTeaPosterErrorMessage,
  type AfternoonTeaPosterViewItem,
} from './AfternoonTeaPosterStep'

const noop = () => {}

const items: AfternoonTeaPosterViewItem[] = [
  { id: 'queued-1', title: '午后茶歇', prompt: '午后茶歇 prompt', status: 'queued' },
  { id: 'running-1', title: '暖心时光', prompt: '暖心时光 prompt', status: 'running' },
  { id: 'done-1', title: '轻松一刻', prompt: '轻松一刻 prompt', status: 'done', outputSrc: 'data:image/png;base64,AQID' },
  { id: 'error-1', title: '惬意茶点', prompt: '惬意茶点 prompt', status: 'error', error: '请求失败，请稍后重试' },
  { id: 'queued-2', title: '茶香满室', prompt: '茶香满室 prompt', status: 'queued' },
]

function renderStep(overrides: Partial<Parameters<typeof AfternoonTeaPosterStep>[0]> = {}) {
  return renderToStaticMarkup(<AfternoonTeaPosterStep
    sourceImageSrc="data:image/png;base64,AQID"
    sourceImageName="tea.png"
    profileName="本地 OpenAI"
    modelName="gpt-image-1"
    items={items}
    busy={false}
    batchStarted
    pageError=""
    onStart={noop}
    onBack={noop}
    onClear={noop}
    onReparse={noop}
    onRetry={noop}
    {...overrides}
  />)
}

describe('AfternoonTeaPosterStep', () => {
  it('shows source image, active image profile summary, and collapsed prompt previews', () => {
    const html = renderStep()
    expect(html).toContain('tea.png')
    expect(html).toContain('本地 OpenAI')
    expect(html).toContain('gpt-image-1')
    expect(html).toContain('<details')
    expect(html).toContain('午后茶歇')
    expect(html).toContain('午后茶歇 prompt')
    expect(html).not.toContain('<textarea')
  })

  it('renders one stable result slot per title and all summary counters', () => {
    const html = renderStep()
    expect((html.match(/data-result-slot=/g) ?? [])).toHaveLength(5)
    expect(html).toContain('总数 5')
    expect(html).toContain('等待 2')
    expect(html).toContain('生成中 1')
    expect(html).toContain('成功 1')
    expect(html).toContain('失败 1')
    expect(html).toContain('aspect-[')
  })

  it('renders completed output with its title and a safe retryable error slot', () => {
    const html = renderStep()
    expect(html).toContain('data:image/png;base64,AQID')
    expect(html).toContain('轻松一刻')
    expect(html).toContain('请求失败，请稍后重试')
    expect(html).toContain('重试此项')
  })

  it('does not fabricate an image when a completed task has no output', () => {
    const html = renderStep({
      items: [{ id: 'done-empty', title: '无图结果', prompt: 'prompt', status: 'done', hasOutput: false }],
    })
    expect(html).toContain('没有输出图片')
    expect(html).not.toContain('正在加载图片')
  })

  it('disables start without a source image and explains the requirement', () => {
    const html = renderStep({ sourceImageSrc: '', sourceImageName: '', batchStarted: false })
    expect(html).toContain('请先上传原图')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>开始批量生成<\/button>/)
  })

  it('locks navigation, reset, retry, and duplicate submission while running', () => {
    const html = renderStep({ busy: true })
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>返回订单解析<\/button>/)
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>重新解析<\/button>/)
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>清空<\/button>/)
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>重试此项<\/button>/)
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>批次生成中<\/button>/)
  })

  it('keeps duplicate submission disabled after a batch has started', () => {
    const html = renderStep({ busy: false, batchStarted: true })
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>已开始生成<\/button>/)
  })

  it('limits setup errors and uses a fixed message for non-errors', () => {
    expect(getAfternoonTeaPosterErrorMessage({ apiKey: 'secret' })).toBe('图片任务创建失败')
    const message = getAfternoonTeaPosterErrorMessage(new Error(`创建失败${'很'.repeat(300)}`))
    expect(message.startsWith('创建失败')).toBe(true)
    expect(message.length).toBeLessThanOrEqual(160)
  })
})
