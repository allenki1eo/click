/**
 * @mwongozo/react — React component wrapper for the Mwongozo web widget.
 *
 * Usage:
 *   import { MwongozoWidget } from '@mwongozo/react'
 *
 *   <MwongozoWidget orgId="tra" proxyUrl="https://your-proxy.example.com" />
 *
 * The widget renders directly into document.body (not into the React tree),
 * matching how the vanilla SDK works. React simply manages the lifecycle.
 */

import { useEffect, useRef } from 'react';
import type { MwongozoProps, OrgConfig } from './types';

export { MwongozoProps, OrgConfig };

export function MwongozoWidget({
  orgId,
  proxyUrl,
  position = 'bottom-right',
  theme,
  name,
  orgConfig: overrideConfig,
  onReady,
}: MwongozoProps): null {
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    let destroyed = false;
    let widgetInstance: any = null;

    const run = async () => {
      // Dynamically import the vanilla SDK to avoid bundling issues
      // The consuming app should have @mwongozo/sdk installed or use the CDN build.
      let MwongozoWidgetClass: any;
      try {
        const mod = await import('@mwongozo/sdk');
        MwongozoWidgetClass = mod.MwongozoWidget;
      } catch {
        console.error('[MwongozoWidget] Could not load @mwongozo/sdk. ' +
          'Install it: npm install @mwongozo/sdk');
        return;
      }

      if (destroyed) return;

      // Fetch org config
      let orgCfg: Partial<OrgConfig> = overrideConfig || {};
      if (!overrideConfig) {
        try {
          const resp = await fetch(
            `${proxyUrl.replace(/\/$/, '')}/config?org=${encodeURIComponent(orgId)}`,
            { headers: { 'X-Org-Id': orgId } }
          );
          if (resp.ok) orgCfg = await resp.json();
        } catch (e) {
          console.warn('[MwongozoWidget] Could not load org config:', e);
          orgCfg = { name: name || 'Msaada', theme: theme || '#00843D' };
        }
      }

      if (destroyed) return;

      widgetInstance = new MwongozoWidgetClass({
        orgId,
        proxyUrl,
        position,
        theme,
        name,
        orgConfig: orgCfg,
      });

      await widgetInstance.init();
      onReady?.();
    };

    run().catch(console.error);

    return () => {
      destroyed = true;
      widgetInstance?.destroy?.();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, proxyUrl]);

  return null;
}

/**
 * React hook — programmatic access to the widget after mounting.
 *
 * Usage:
 *   const { widgetRef, MwongozoWidget } = useMwongozo()
 *   // Later: widgetRef.current?.openPanel()
 */
export function useMwongozo() {
  const widgetRef = useRef<any>(null);

  const MwongozoWidgetWithRef = (props: MwongozoProps) => (
    <MwongozoWidget
      {...props}
      onReady={() => {
        widgetRef.current = (window as any).mwongozo ?? null;
        props.onReady?.();
      }}
    />
  );

  return { widgetRef, MwongozoWidget: MwongozoWidgetWithRef };
}
