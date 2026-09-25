import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AfternoonTeaNotice } from '../../lib/afternoonTeaNotice'
import { AfternoonTeaNoticeFormView, type AfternoonTeaNoticeFormViewProps } from './AfternoonTeaNoticeWorkflow'
import noticeWorkflowSource from './AfternoonTeaNoticeWorkflow.tsx?raw'
import { AFTERNOON_TEA_NOTICE_RESULT_COUNT } from '../../lib/afternoonTeaNoticePrompts'

const noop = () => {}

const notices: AfternoonTeaNotice[] = [
  { style: '可爱活泼', text: '🍰下午茶来咯～' },
  { style: '清单安利', text: '今日有巴斯克和果汁' },
  { style: '轻松催领', text: '工作间隙来领一份' },
  { style: '简洁清新', text: '下午茶已备好，请来领取。' },
]

function formProps(overrides: Partial<AfternoonTeaNoticeFormViewProps> = {}): AfternoonTeaNoticeFormViewProps {
  return {
    configured: true,
    menuText: '原味巴斯克',
    brand: '',
    systemPrompt: '系统提示词',
    notices: [],
    selectedIndex: 0,
    status: 'idle',
    elapsed: null,
    error: '',
    clipboardAvailable: true,
    clipboardError: '',
    sourceChannel: '',
    sourceModel: '',
    onMenuTextChange: noop,
    onBrandChange: noop,
    onSystemPromptChange: noop,
    onResetSystemPrompt: noop,
    onNoticeTextChange: noop,
    onSelectedIndexChange: noop,
    onPasteMenu: noop,
    onSubmit: noop,
    onCancel: noop,
    onCopy: noop,
    ...overrides,
  }
}

function renderForm(overrides: Partial<AfternoonTeaNoticeFormViewProps> = {}) {
  return renderToStaticMarkup(<AfternoonTeaNoticeFormView {...formProps(overrides)} />)
}

function buttonMarkup(html: string, ariaLabel: string) {
  const marker = `aria-label="${ariaLabel}"`
  const index = html.indexOf(marker)
  if (index < 0) return ''
  const start = html.lastIndexOf('<button', index)
  const end = html.indexOf('>', index)
  return html.slice(start, end + 1)
}

describe('AfternoonTeaNoticeFormView', () => {
  it('keeps brand optional and disables generate without a menu', () => {
    const html = renderForm({ menuText: '  ', brand: '' })

    expect(html).toContain('补充信息')
    expect(html).toContain('例如：汉堡包、奶茶、霸王茶姬')
    expect(html).not.toContain('品牌（选填）')
    expect(html).toContain('今日菜单')
    expect(html).toContain('粘贴')
    expect(html).toContain('高级设置')
    expect(html).toContain('左上蛋黄肉+芝士肉+虾仁肉+牛肉小饼')
    expect(html).toContain('套餐A：东坡淋汁豆腐+现磨原味豆浆')
    expect(html).toContain(`每次 ${AFTERNOON_TEA_NOTICE_RESULT_COUNT} 张`)
    expect(html).toContain(`生成后给出 ${AFTERNOON_TEA_NOTICE_RESULT_COUNT} 张菜单卡，菜品相同，开场和收尾不同`)
    expect(buttonMarkup(html, '生成通知')).toContain('disabled=""')
  })

  it('enables generate when a menu is present even without a brand', () => {
    const html = renderForm({ menuText: '原味巴斯克', brand: '' })
    const generateButton = buttonMarkup(html, '生成通知')

    expect(generateButton).not.toBe('')
    expect(generateButton).not.toContain('disabled=""')
  })

  it('keeps generate disabled until the understanding model is configured', () => {
    const html = renderForm({ configured: false, menuText: '原味巴斯克' })

    expect(html).toContain('请先在 API 配置中选择 OpenAI 配置，并填写语义理解/多模态模型 ID')
    expect(buttonMarkup(html, '生成通知')).toContain('disabled=""')
  })

  it('renders copy actions for generated styles and switches the primary action to regenerate', () => {
    const html = renderForm({ notices, selectedIndex: 0, status: 'success' })

    expect(html).toContain('可爱活泼')
    expect(html).toContain('清单安利')
    expect(html).toContain('轻松催领')
    expect(html).toContain('简洁清新')
    expect(html).toContain('aria-label="复制可爱活泼通知"')
    expect(html).toContain('aria-label="复制清单安利通知"')
    expect(html).toContain(`本次 ${notices.length} 张`)
    expect(html).toContain('grid-cols-2')
    expect(html).toContain('rounded-full')
    expect(buttonMarkup(html, '再生成')).not.toContain('disabled=""')
    expect(html).toContain('点击复制')
    expect(buttonMarkup(html, '复制可爱活泼通知')).not.toContain('disabled=""')
  })

  it('shows cancel while generating', () => {
    const html = renderForm({ status: 'running', elapsed: 1_000 })

    expect(buttonMarkup(html, '取消生成')).not.toContain('disabled=""')
    expect(html).toContain('正在生成通知')
    expect(html).toContain(`正在生成 ${AFTERNOON_TEA_NOTICE_RESULT_COUNT} 张菜单卡`)
  })

  it('shows the channel and model used for this notice under the status', () => {
    const html = renderForm({
      status: 'running',
      sourceChannel: '测试渠道',
      sourceModel: 'gpt-4.1-mini',
    })

    expect(html).toContain('aria-label="通知渠道和模型"')
    expect(html).toContain('渠道 测试渠道 · 模型 gpt-4.1-mini')
    expect(renderForm({ status: 'idle' })).not.toContain('通知渠道和模型')
  })

  it('generates through the shared notice module', () => {
    expect(noticeWorkflowSource).toContain('runAfternoonTeaNotice({')
    expect(noticeWorkflowSource).toContain('supplement: brand')
    expect(noticeWorkflowSource).not.toContain('pickAfternoonTeaNoticeStyles')
  })

  it('copies the card text through the provided handler', () => {
    expect(noticeWorkflowSource).toContain('if (canCopy) props.onCopy(notice.text)')
    expect(noticeWorkflowSource).toContain("showToast('已复制', 'success')")
    expect(noticeWorkflowSource).toContain('copyTextToClipboard(text)')
  })
})
