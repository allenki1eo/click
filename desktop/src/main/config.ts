/**
 * Config — stores proxy URL in electron-store.
 * API keys live on the proxy server, never here.
 */
import Store from 'electron-store'

interface Schema {
  proxyUrl: string
}

const store = new Store<Schema>({
  name: 'mwongozo',
  encryptionKey: 'mwongozo-v1',
  defaults: { proxyUrl: 'http://localhost:8787' },
})

export function getProxyUrl(): string {
  return store.get('proxyUrl')
}

export function setProxyUrl(url: string): void {
  store.set('proxyUrl', url)
}
