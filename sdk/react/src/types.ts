export interface OrgConfig {
  id: string;
  name: string;
  fullName?: string;
  theme: string;
  language: string;
  welcomeMessage?: string;
  suggestedQuestions?: string[];
}

export type OrbPosition = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

export interface MwongozoProps {
  /** Org identifier: 'tra' | 'brela' | 'crdb' | 'nmb' | custom */
  orgId: string;

  /** URL of the Mwongozo proxy server */
  proxyUrl: string;

  /** Position of the floating orb */
  position?: OrbPosition;

  /** Fallback theme hex color if org config unavailable */
  theme?: string;

  /** Fallback assistant name */
  name?: string;

  /** Override org config fetched from proxy */
  orgConfig?: Partial<OrgConfig>;

  /** Called once the widget is initialized */
  onReady?: () => void;
}
