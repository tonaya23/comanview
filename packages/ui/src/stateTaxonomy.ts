export type UiStateKind = 'loading' | 'empty' | 'success' | 'warning' | 'recoverable-error' |
  'missing-prerequisite' | 'permission-denied' | 'offline' | 'degraded' | 'recovery-required' |
  'suspended-licensing' | 'stale-occ';
export type UiSeverity = 'neutral' | 'info' | 'success' | 'warning' | 'error' | 'critical';
export type UiPresentation = 'inline' | 'banner' | 'blocking';
export type UiActionPattern = 'none' | 'retry' | 'configure' | 'request-access' | 'reconnect' |
  'recover' | 'contact-administrator' | 'refresh';

export interface UiStateSemantics {
  kind: UiStateKind;
  severity: UiSeverity;
  presentation: UiPresentation;
  role: 'status' | 'alert';
  expectedAction: UiActionPattern;
}

export const UI_STATE_TAXONOMY = {
  loading: { kind:'loading', severity:'neutral', presentation:'inline', role:'status', expectedAction:'none' },
  empty: { kind:'empty', severity:'neutral', presentation:'inline', role:'status', expectedAction:'none' },
  success: { kind:'success', severity:'success', presentation:'inline', role:'status', expectedAction:'none' },
  warning: { kind:'warning', severity:'warning', presentation:'inline', role:'status', expectedAction:'none' },
  'recoverable-error': { kind:'recoverable-error', severity:'error', presentation:'inline', role:'alert', expectedAction:'retry' },
  'missing-prerequisite': { kind:'missing-prerequisite', severity:'warning', presentation:'inline', role:'status', expectedAction:'configure' },
  'permission-denied': { kind:'permission-denied', severity:'warning', presentation:'inline', role:'alert', expectedAction:'request-access' },
  offline: { kind:'offline', severity:'error', presentation:'banner', role:'alert', expectedAction:'reconnect' },
  degraded: { kind:'degraded', severity:'warning', presentation:'banner', role:'status', expectedAction:'retry' },
  'recovery-required': { kind:'recovery-required', severity:'critical', presentation:'blocking', role:'alert', expectedAction:'recover' },
  'suspended-licensing': { kind:'suspended-licensing', severity:'critical', presentation:'blocking', role:'alert', expectedAction:'contact-administrator' },
  'stale-occ': { kind:'stale-occ', severity:'warning', presentation:'inline', role:'alert', expectedAction:'refresh' },
} as const satisfies Record<UiStateKind, UiStateSemantics>;
