import type { UserGuidance } from './guidance.js';
import type { TypedNavigationTarget } from './navigation.js';

export type PrerequisiteStatus = 'complete' | 'missing' | 'blocked' | 'unavailable' | 'not-applicable';
export interface PrerequisiteAuthority {
  source: 'edge' | 'signed-configuration' | 'local-session';
  observedAt?: string;
  stale?: boolean;
}
export interface PrerequisiteState {
  key: string;
  label: string;
  status: PrerequisiteStatus;
  reasonCode?: string;
  guidance?: UserGuidance;
  action?: {label:string;target:TypedNavigationTarget};
  authority?: PrerequisiteAuthority;
}

export function prerequisite(input: PrerequisiteState): PrerequisiteState {
  const action=input.action??input.guidance?.action;
  return {...input,...(action?{action}:{})};
}
