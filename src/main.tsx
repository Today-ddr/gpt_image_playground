import 'core-js/actual/array/at'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import 'streamdown/styles.css'
import 'katex/dist/katex.min.css'
import './index.css'
import { ErrorBoundary, isChunkLoadError, tryReloadOnce } from './components/ErrorBoundary'
import { installMobileViewportGuards } from './lib/viewport'
import { getAppModeFromUrlParams } from './lib/urlSettings'
import { useStore } from './store'

installMobileViewportGuards()

const initialAppMode = getAppModeFromUrlParams(new URLSearchParams(window.location.search))
if (initialAppMode) useStore.getState().setAppMode(initialAppMode)

function ensureRoot() {
  const existing = document.getElementById('root')
  if (existing) return existing
  const el = document.createElement('div')
  el.id = 'root'
  document.body.prepend(el)
  return el
}

window.addEventListener('unhandledrejection', (event) => {
  if (!isChunkLoadError(event.reason)) return
  event.preventDefault()
  tryReloadOnce()
})

window.addEventListener('error', (event) => {
  if (!isChunkLoadError(event.error ?? event.message)) return
  tryReloadOnce()
}, true)

if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    // 已有旧 SW 时，新版本接管后立刻刷新，避免旧 HTML 去拉已被删的 hashed 资源。
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        window.location.reload()
      })
    }
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((error) => {
        console.error('Service worker registration failed:', error)
      })
    })
  } else {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => registration.unregister())
    })
  }
}

createRoot(ensureRoot()).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
