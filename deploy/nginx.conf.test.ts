import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('docker API proxy nginx config', () => {
  const nginxConf = readFileSync('deploy/nginx.conf', 'utf8')

  it('allows GET model-list requests through the API proxy', () => {
    expect(nginxConf).toMatch(/limit_except GET POST OPTIONS/)
  })

  it('forwards to the request API URL header when provided', () => {
    expect(nginxConf).toContain('$http_x_api_proxy_target')
    expect(nginxConf).toContain('X-Api-Proxy-Target')
  })

  it('drops browser Origin so upstreams that reject cross-origin calls still answer', () => {
    expect(nginxConf).toContain('proxy_set_header Origin "";')
    expect(nginxConf).toContain('proxy_set_header Access-Control-Request-Method "";')
    expect(nginxConf).toContain('proxy_set_header Access-Control-Request-Headers "";')
  })
})

