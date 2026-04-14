/**
 * Config — stores proxy URL + orb customisation in electron-store.
 * API keys live on the proxy server, never here.
 */
import Store from 'electron-store'
import type { OrbConfig } from '../shared/types'

interface Schema {
  proxyUrl: string
  orbName: string
  orbTheme: string
  orbPersonality: OrbConfig['personality']
  orbWakeWord: boolean
}

const store = new Store<Schema>({
  name: 'mwongozo',
  encryptionKey: 'mwongozo-v1',
  defaults: {
    proxyUrl: 'http://localhost:8787',
    orbName: 'Mwongozo',
    orbTheme: '#10b981',
    orbPersonality: 'friendly',
    orbWakeWord: false,
  },
})

export function getProxyUrl(): string {
  return store.get('proxyUrl')
}

export function setProxyUrl(url: string): void {
  store.set('proxyUrl', url)
}

export function getOrbConfig(): OrbConfig {
  return {
    name:            store.get('orbName'),
    theme:           store.get('orbTheme'),
    personality:     store.get('orbPersonality'),
    wakeWordEnabled: store.get('orbWakeWord'),
  }
}

export function setOrbConfig(cfg: Partial<OrbConfig>): void {
  if (cfg.name            !== undefined) store.set('orbName',        cfg.name)
  if (cfg.theme           !== undefined) store.set('orbTheme',       cfg.theme)
  if (cfg.personality     !== undefined) store.set('orbPersonality', cfg.personality)
  if (cfg.wakeWordEnabled !== undefined) store.set('orbWakeWord',    cfg.wakeWordEnabled)
}
