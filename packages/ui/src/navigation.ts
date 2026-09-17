export type AdministrationNavigationTarget = {
  surface: 'administration';
  section: 'business-profile' | 'day-currency' | 'taxes' | 'tips' | 'registers' |
    'stations' | 'zones-tables' | 'personnel';
};

export type SystemNavigationTarget = {
  surface: 'system';
  section: 'devices' | 'readiness' | 'backup-recovery';
};

/** Machine-readable intent. Each app decides how to present it; this is not a URL router. */
export type TypedNavigationTarget = AdministrationNavigationTarget | SystemNavigationTarget;

export const navigationTarget = {
  administration: (section: AdministrationNavigationTarget['section']): AdministrationNavigationTarget =>
    ({ surface: 'administration', section }),
  system: (section: SystemNavigationTarget['section']): SystemNavigationTarget =>
    ({ surface: 'system', section }),
};
