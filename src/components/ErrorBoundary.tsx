import { Component, type ErrorInfo, type ReactNode } from 'react'

const RELOAD_ONCE_KEY = 'gpt-image-playground.render-recovery'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export function isChunkLoadError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk|Loading CSS chunk/i.test(message)
}

export function tryReloadOnce() {
  try {
    if (sessionStorage.getItem(RELOAD_ONCE_KEY) === '1') return false
    sessionStorage.setItem(RELOAD_ONCE_KEY, '1')
  } catch {
    return false
  }
  window.location.reload()
  return true
}

export function clearRenderRecoveryFlag() {
  try {
    sessionStorage.removeItem(RELOAD_ONCE_KEY)
  } catch {
    // 隐私模式读不了 sessionStorage 时忽略。
  }
}

/** React 只能用 class 组件捕获渲染期错误，避免整页被卸载成空白。 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }
  private stableTimer: ReturnType<typeof setTimeout> | null = null

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('页面渲染失败', error, info.componentStack)
    if (isChunkLoadError(error)) tryReloadOnce()
  }

  componentDidMount() {
    this.stableTimer = setTimeout(() => clearRenderRecoveryFlag(), 2500)
  }

  componentWillUnmount() {
    if (this.stableTimer != null) window.clearTimeout(this.stableTimer)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="safe-area-x mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
        <h1 className="text-lg font-semibold text-gray-800 dark:text-gray-100">页面加载失败</h1>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          刷新后通常就能恢复。如果反复出现，请先关掉翻译类浏览器扩展再试。
        </p>
        <button
          type="button"
          className="mt-6 min-h-11 rounded-xl bg-blue-500 px-5 text-sm font-medium text-white hover:bg-blue-600"
          onClick={() => window.location.reload()}
        >
          刷新页面
        </button>
      </div>
    )
  }
}
