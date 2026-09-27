import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'
import { normalizeDevProxyConfig, resolveApiProxyUpstream } from './src/lib/devProxy'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

function loadDevProxyConfig() {
  try {
    return normalizeDevProxyConfig(
      JSON.parse(readFileSync('./dev-proxy.config.json', 'utf-8')) as unknown,
    )
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    if (err.code === 'ENOENT') return null
    throw error
  }
}

export default defineConfig(({ command }) => {
  const devProxyConfig = command === 'serve' ? loadDevProxyConfig() : null

  return {
    plugins: [react()],
    base: './',
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __DEV_PROXY_CONFIG__: JSON.stringify(devProxyConfig),
    },
    server: {
      host: true,
      port: 5175,
      strictPort: true,
      proxy:
        devProxyConfig?.enabled
          ? {
              [devProxyConfig.prefix]: {
                target: devProxyConfig.target,
                changeOrigin: devProxyConfig.changeOrigin,
                secure: devProxyConfig.secure,
                // 与 Docker Nginx 一致：上游见到 Origin 会 403，开发代理也不能把浏览器来源头带过去。
                configure: (proxy) => {
                  proxy.on('proxyReq', (proxyReq) => {
                    proxyReq.removeHeader('origin')
                    proxyReq.removeHeader('access-control-request-method')
                    proxyReq.removeHeader('access-control-request-headers')
                  })
                },
                router: (req) => resolveApiProxyUpstream(
                  req.headers['x-api-proxy-target'],
                  devProxyConfig.target,
                ),
                rewrite: (path) =>
                  path.replace(
                    new RegExp(`^${devProxyConfig.prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
                    '',
                  ),
              },
            }
          : undefined,
    },
  }
})
