import { describe, expect, it } from 'vitest'
import settingsModal from './SettingsModal.tsx?raw'

describe('browser storage usage content', () => {
  it('shows storage usage labels and the unavailable message', () => {
    expect(settingsModal).toContain('浏览器存储')
    expect(settingsModal).toContain('已使用')
    expect(settingsModal).toContain('浏览器配额')
    expect(settingsModal).toContain('当前浏览器无法提供存储占用信息')
    expect(settingsModal).toContain('任务')
    expect(settingsModal).toContain('原图')
    expect(settingsModal).toContain('缩略图')
    expect(settingsModal).toContain('配置')
    expect(settingsModal).toContain('本站缓存')
    expect(settingsModal).toContain('浏览器估算')
  })

  it('refreshes storage usage when the data tab is active', () => {
    const effectStart = settingsModal.indexOf("if (!showSettings || activeTab !== 'data') return")
    const effectEnd = settingsModal.indexOf('}, [showSettings, activeTab, refreshBrowserStorageUsage])', effectStart)
    const effect = settingsModal.slice(effectStart, effectEnd)

    expect(effectStart).toBeGreaterThan(-1)
    expect(effectEnd).toBeGreaterThan(effectStart)
    expect(effect).toContain('refreshBrowserStorageUsage()')
  })

  it('refreshes storage usage after a successful import', () => {
    const handlerStart = settingsModal.indexOf('const handleImport = async')
    const handlerEnd = settingsModal.indexOf('const handleClearAllData = async', handlerStart)
    const handler = settingsModal.slice(handlerStart, handlerEnd)
    const importedBranchStart = handler.indexOf('if (imported)')
    const importedBranchEnd = handler.indexOf('\n        }\n      } finally', importedBranchStart)
    const beforeImportedBranch = handler.slice(0, importedBranchStart)
    const importedBranch = handler.slice(importedBranchStart, importedBranchEnd)

    expect(handlerStart).toBeGreaterThan(-1)
    expect(handlerEnd).toBeGreaterThan(handlerStart)
    expect(importedBranchStart).toBeGreaterThan(-1)
    expect(importedBranchEnd).toBeGreaterThan(importedBranchStart)
    expect(beforeImportedBranch).not.toContain('refreshBrowserStorageUsage()')
    expect(importedBranch).toContain('void refreshBrowserStorageUsage()')
    expect(importedBranch).not.toContain('await refreshBrowserStorageUsage()')
  })

  it('refreshes storage usage after clearing data', () => {
    const handlerStart = settingsModal.indexOf('const handleClearAllData = async')
    const handlerEnd = settingsModal.indexOf('const createNewProfile =', handlerStart)
    const handler = settingsModal.slice(handlerStart, handlerEnd)
    const clearDataIndex = handler.indexOf('await clearData')
    const stateRefreshEnd = handler.indexOf('setShowProfileMenu(false)')
    const storageRefreshIndex = handler.indexOf('await refreshBrowserStorageUsage()')

    expect(handlerStart).toBeGreaterThan(-1)
    expect(handlerEnd).toBeGreaterThan(handlerStart)
    expect(clearDataIndex).toBeGreaterThan(-1)
    expect(stateRefreshEnd).toBeGreaterThan(clearDataIndex)
    expect(storageRefreshIndex).toBeGreaterThan(stateRefreshEnd)
  })

  it('exposes loading and progress state to assistive technology', () => {
    expect(settingsModal).toContain('role="status"')
    expect(settingsModal).toContain('aria-label="浏览器存储占用比例"')
    expect(settingsModal).toContain('aria-valuetext={browserStoragePercentageLabel ?? undefined}')
  })

  it('uses the rounded display percentage for the label and color thresholds', () => {
    expect(settingsModal).toContain('const browserStorageDisplayPercentage =')
    expect(settingsModal).toContain('Math.round(browserStorageUsage.percentage * 10) / 10')
    expect(settingsModal).toContain('`${browserStorageDisplayPercentage}%`')
    expect(settingsModal).toContain('browserStorageDisplayPercentage >= 90')
    expect(settingsModal).toContain('browserStorageDisplayPercentage >= 70')
    expect(settingsModal).toContain('style={{ width: `${browserStorageUsage.percentage}%` }}')
  })
})
