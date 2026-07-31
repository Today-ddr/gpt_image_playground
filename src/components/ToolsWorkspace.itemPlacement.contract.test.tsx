import { describe, expect, it } from 'vitest'
import workspaceSource from './ToolsWorkspace.tsx?raw'
import workflowSource from './tools/AfternoonTeaMobileWorkflow.tsx?raw'

describe('order item title placement wiring', () => {
  it('mounts one placement editor in the shared review workflow', () => {
    const reviewStart = workflowSource.indexOf("{phase === 'review' && props.orderResult && (")
    const reviewSource = workflowSource.slice(reviewStart, workflowSource.indexOf("{(phase === 'generating' || phase === 'results') && (", reviewStart))

    expect(reviewStart).toBeGreaterThan(-1)
    expect((workflowSource.match(/<AfternoonTeaItemPlacement\b/g) ?? [])).toHaveLength(1)
    expect(reviewSource).toContain('<AfternoonTeaItemPlacement')
    expect(reviewSource).toContain('itemTitleRegions')
    expect(reviewSource).toContain('onItemTitleRegionsChange')
    expect(reviewSource).toContain('aria-label="审查工作区"')
    expect(reviewSource).toContain('lg:grid-cols-[')
  })

  it('orders placement before poster titles and combined item metadata', () => {
    const placementStart = workflowSource.indexOf('<AfternoonTeaItemPlacement')
    const posterTitleStart = workflowSource.indexOf('aria-label="海报标题"', placementStart)
    const itemMetadataStart = workflowSource.indexOf('aria-label="餐品与标签"', posterTitleStart)

    expect(placementStart).toBeGreaterThan(-1)
    expect(posterTitleStart).toBeGreaterThan(placementStart)
    expect(itemMetadataStart).toBeGreaterThan(posterTitleStart)
    expect(workflowSource).not.toContain('<span>餐品标签</span>')
  })

  it('rebuilds prompts from the latest conversation and locks after batch start', () => {
    const prepareStart = workspaceSource.indexOf('const prepareAfternoonTeaPosterItems = () => {')
    const prepareSource = workspaceSource.slice(prepareStart, workspaceSource.indexOf('const confirmAndGenerate', prepareStart))

    expect(prepareStart).toBeGreaterThan(-1)
    expect(prepareSource).toContain('const state = useStore.getState()')
    expect(prepareSource).toContain('buildAfternoonTeaPosterPrompts')
    expect(prepareSource).toContain('itemTitleRegions')
    expect(workspaceSource).toContain('batchStartedAt != null')
    expect(workspaceSource).toContain('onItemTitleRegionsChange')
  })

  it('keeps the shared placement stage touch friendly without an early desktop split', () => {
    expect(workflowSource).toContain('min-w-0')
    expect(workflowSource).toContain('onBlur')
    expect(workflowSource).toContain('onKeyDown')
    expect(workflowSource).not.toMatch(/(?:sm|md):grid-cols-\[minmax\(0,1\.05fr\)/)
  })

  it('places every responsive phase below one desktop progress and CTA row', () => {
    expect(workflowSource).toContain('aria-label="餐品海报工作流"')
    expect(workflowSource).toContain('lg:grid-cols-[minmax(0,1fr)_auto]')
    expect((workflowSource.match(/aria-label="工作流主操作"/g) ?? [])).toHaveLength(1)
    expect((workflowSource.match(/lg:col-span-2 lg:row-start-2/g) ?? [])).toHaveLength(3)
  })
})
