export type BrowserStorageUsage = {
  usage: number
  quota: number | null
  percentage: number | null
}

export function formatStorageBytes(bytes: number) {
  if (bytes < 1024) return `${Math.round(bytes)} B`

  const units = ['KB', 'MB', 'GB', 'TB']
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)) - 1, units.length - 1)
  const value = bytes / 1024 ** (unitIndex + 1)
  const formatted = value < 10 ? Math.round(value * 10) / 10 : Math.round(value)

  return `${formatted} ${units[unitIndex]}`
}

export function getStorageUsagePercentage(usage: number, quota?: number) {
  if (!Number.isFinite(quota) || !quota || quota <= 0) return null
  return Math.min(100, Math.max(0, usage / quota * 100))
}

export async function getBrowserStorageUsage(): Promise<BrowserStorageUsage | null> {
  if (typeof navigator === 'undefined' || typeof navigator.storage?.estimate !== 'function') return null

  try {
    const estimate = await navigator.storage.estimate()
    if (typeof estimate.usage !== 'number' || !Number.isFinite(estimate.usage) || estimate.usage < 0) return null

    const quota = typeof estimate.quota === 'number' && Number.isFinite(estimate.quota) && estimate.quota > 0
      ? estimate.quota
      : null

    return {
      usage: estimate.usage,
      quota,
      percentage: quota === null ? null : getStorageUsagePercentage(estimate.usage, quota),
    }
  } catch (err) {
    console.warn('读取浏览器存储占用失败', err)
    return null
  }
}
