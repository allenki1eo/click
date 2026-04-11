/**
 * Org profile configuration manager.
 *
 * New module (no Clicky equivalent) — handles:
 *  - Local encrypted storage of the org profile
 *  - Org code activation via the proxy API
 *  - Providing profile data to the rest of the main process
 *
 * The org profile is stored locally using electron-store so the user
 * only enters their org code once. electron-store encrypts at rest on
 * all platforms.
 *
 * API keys are NEVER stored here — they live on the proxy server.
 */

import { ipcMain } from 'electron'
import Store from 'electron-store'
import { IPC } from '../shared/ipc'
import type { OrgProfile, ActivateCodeRequest, ActivateCodeResponse } from '../shared/types'

// ---------------------------------------------------------------------------
// Demo / dev hardcoded profile
// ---------------------------------------------------------------------------

const DEMO_ORG_CODE = 'DEMO-TZ-0001'
const DEMO_ORG_PROFILE: OrgProfile = {
  orgId: 'demo-org-id',
  orgName: 'Demo Organisation',
  logoUrl: '',
  flowAccess: ['tra-vat-filing', 'tra-paye', 'brela-registration', 'zssf-contribution', 'nhif-registration'],
  language: 'sw',
  customInstructions: 'This is a demo environment. Help the user navigate Tanzanian government portals.',
  analyticsEnabled: false,
  activationCode: DEMO_ORG_CODE
}

// ---------------------------------------------------------------------------
// Storage schema
// ---------------------------------------------------------------------------

interface StoreSchema {
  orgProfile: OrgProfile | null
  proxyUrl: string
}

export class ConfigManager {
  private store: Store<StoreSchema>
  private currentProfile: OrgProfile | null = null

  constructor() {
    this.store = new Store<StoreSchema>({
      name: 'mwongozo-config',
      // Encrypt the store — keeps the org code and profile off plain disk
      encryptionKey: 'mwongozo-local-key-v1',
      defaults: {
        orgProfile: null,
        proxyUrl: 'https://mwongozo-proxy.workers.dev'
      }
    })
  }

  async init(): Promise<void> {
    this.currentProfile = this.store.get('orgProfile', null)
    console.info('[ConfigManager] Loaded stored profile:', this.currentProfile?.orgName ?? '(none)')
  }

  getStoredProfile(): OrgProfile | null {
    return this.currentProfile
  }

  getProxyUrl(): string {
    return this.store.get('proxyUrl', 'https://mwongozo-proxy.workers.dev')
  }

  // ---------------------------------------------------------------------------
  // IPC handler registration
  // ---------------------------------------------------------------------------

  registerIpcHandlers(): void {
    ipcMain.handle(IPC.CONFIG.GET_PROFILE, () => this.currentProfile)

    ipcMain.handle(IPC.CONFIG.ACTIVATE_CODE, async (_, request: ActivateCodeRequest): Promise<ActivateCodeResponse> => {
      return await this.activateCode(request)
    })

    ipcMain.handle(IPC.CONFIG.CLEAR_PROFILE, () => {
      this.currentProfile = null
      this.store.set('orgProfile', null)
      console.info('[ConfigManager] Profile cleared')
    })
  }

  // ---------------------------------------------------------------------------
  // Code activation
  // ---------------------------------------------------------------------------

  private async activateCode(request: ActivateCodeRequest): Promise<ActivateCodeResponse> {
    const { code } = request

    // Shortcut for demo code — works fully offline without a proxy
    if (code.toUpperCase() === DEMO_ORG_CODE) {
      this.currentProfile = DEMO_ORG_PROFILE
      this.store.set('orgProfile', DEMO_ORG_PROFILE)
      console.info('[ConfigManager] Demo code activated — using local demo profile')
      return { success: true, profile: DEMO_ORG_PROFILE }
    }

    // For real org codes, call the proxy
    const proxyUrl = this.getProxyUrl()
    try {
      const response = await fetch(`${proxyUrl}/activate-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.toUpperCase(), appVersion: request.appVersion })
      })

      if (!response.ok) {
        const errorBody = await response.text()
        console.error('[ConfigManager] activate-code error:', response.status, errorBody)
        return { success: false, error: `Hitilafu ya seva: ${response.status}` }
      }

      const data = (await response.json()) as { profile: OrgProfile }
      this.currentProfile = data.profile
      this.store.set('orgProfile', data.profile)
      console.info('[ConfigManager] Org code activated:', data.profile.orgName)
      return { success: true, profile: data.profile }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[ConfigManager] activate-code network error:', message)
      return {
        success: false,
        error: 'Hakuna muunganiko wa mtandao. Jaribu tena. (No network connection. Please try again.)'
      }
    }
  }
}
