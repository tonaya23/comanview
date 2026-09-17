import { useEffect, useRef, useState } from 'react';
import { EdgeClientError, type EdgeClient } from '@comanview/client-sdk';
import type {
  RestaurantAdministrationState,
  TaxAdministrationState,
  PersonnelList,
  ProductResponse,
  InstallationReadiness,
  EdgeConfiguration,
} from '@comanview/contracts';
import { getUserGuidance, type TypedNavigationTarget, type UserGuidance } from '@comanview/ui';
import {
  AdministrationDraftStore,
  AdministrationResources,
  ADMIN_SECTIONS,
  canOpenAdminSection,
  resolveAdminTarget,
  sectionIndex,
  type AdminSectionId,
} from './administrationModel.js';
import { useAdministrationDialogs } from './AdministrationDialogs.js';
import { cashRegisterCreationIssue, administrationErrorGuidance } from './AdministrationFields.js';
export type AdministrationProps = {
  edge: EdgeClient;
  currentUserId: string;
  permissions: readonly string[];
  initialTarget?: TypedNavigationTarget | null;
  onNavigate?(target: TypedNavigationTarget): void;
  onClose(): void;
};
const commandId = () => crypto.randomUUID();
export function useAdministrationController({
  edge,
  currentUserId,
  permissions,
  initialTarget,
  onNavigate,
  onClose,
}: AdministrationProps) {
  const [admin, setAdmin] = useState<RestaurantAdministrationState | null>(null),
    [tax, setTax] = useState<TaxAdministrationState | null>(null),
    [people, setPeople] = useState<PersonnelList | null>(null),
    [configuration, setConfiguration] = useState<EdgeConfiguration | null>(null),
    [products, setProducts] = useState<ProductResponse[]>([]),
    [error, setError] = useState<string | null>(null),
    [errorGuidance, setErrorGuidance] = useState<UserGuidance | null>(null),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [draftTick, setDraftTick] = useState(0);
  const drafts = useRef(new AdministrationDraftStore()).current;
  const markDirty = (key: string) => {
    setNotice('');
    drafts.mark(key);
    setDraftTick((x) => x + 1);
  };
  const [activeSection, setActiveSection] = useState<AdminSectionId>(
    () =>
      resolveAdminTarget(initialTarget, permissions) ??
      ADMIN_SECTIONS.find((item) => canOpenAdminSection(item.id, permissions))?.id ??
      'business-profile',
  );
  const section = sectionIndex[activeSection];
  const [choices, setChoices] = useState<Record<string, { value: string; version: number }>>({});
  function choose(key: string, initial: string, version: number, value: string) {
    drafts.observe(key, activeSection, { value: initial }, version);
    drafts.mark(key);
    const baseline = choices[key]?.version ?? version;
    drafts.observe(key, activeSection, { value }, baseline);
    setChoices((current) => ({ ...current, [key]: { value, version: baseline } }));
    setDraftTick((tick) => tick + 1);
  }
  function discardChoice(key: string) {
    drafts.saved(key);
    setChoices((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }
  const [readiness, setReadiness] = useState<InstallationReadiness | null>(null);
  async function consultReadiness() {
    if (!permissions.includes('DEVICE_VIEW') || busy) return;
    setBusy(true);
    try {
      setReadiness(await edge.getInstallationReadiness());
    } catch (error) {
      const guidance = administrationErrorGuidance(error);
      setError(guidance.explanation);
      setErrorGuidance(guidance);
    } finally {
      setBusy(false);
    }
  }
  const resourcesCache = useRef(new AdministrationResources()).current;
  const loadSequence = useRef(0);
  const { ask, confirm, dialogs, dialogOpen, lastEdit, clearEdit, takeEditSubmission } =
    useAdministrationDialogs();
  const [conflicts, setConflicts] = useState<
    Record<
      string,
      {
        section: AdminSectionId;
        draft: string | null;
        consulted: boolean;
      }
    >
  >({});
  const activeConflict = Object.entries(conflicts).find(
    ([, entry]) => entry.section === activeSection,
  );
  const conflict = Boolean(activeConflict);
  const conflictDraft = activeConflict?.[1].draft ?? null;
  const conflictConsulted = activeConflict?.[1].consulted ?? false;
  const clearConflict = (key: string) =>
    setConflicts((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  const setConflict = (_value: false) => {
    if (activeConflict) clearConflict(activeConflict[0]);
  };
  useEffect(() => {
    const target = resolveAdminTarget(initialTarget, permissions);
    if (target) setActiveSection(target);
  }, [initialTarget, permissions]);
  const navigate = async (target: TypedNavigationTarget) => {
    if (busy || dialogOpen || pinRequest) return;
    const local = resolveAdminTarget(target, permissions);
    if (local) {
      setActiveSection(local);
      return;
    }
    if (target.surface === 'system' && permissions.includes('DEVICE_VIEW')) {
      if (
        (!drafts.dirty && !lastEdit) ||
        (await confirm(
          'Hay cambios sin guardar. Abrir Sistema cerrará Administración y descartará estos borradores. ¿Continuar?',
        ))
      )
        onNavigate?.(target);
    }
  };
  const [loaded, setLoaded] = useState(false),
    [resourceErrors, setResourceErrors] = useState<Record<string, string>>({});
  const [reconciliationPending, setReconciliationPending] = useState(false);
  const [profileVersion, setProfileVersion] = useState(0),
    [dayVersion, setDayVersion] = useState(0),
    [currencyVersion, setCurrencyVersion] = useState(0);
  const [pinRequest, setPinRequest] = useState<{
    requireCurrent: boolean;
    submit(values: { newPin: string; oldPin?: string }): void;
  } | null>(null);
  const capturePin = (
    requireCurrent: boolean,
    submit: (values: { newPin: string; oldPin?: string }) => void,
  ) => setPinRequest({ requireCurrent, submit });
  const showLocalError = (text: string) => {
    setErrorGuidance(null);
    setError(text);
  };
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (drafts.dirty || lastEdit) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [drafts, draftTick, lastEdit]);
  const [profile, setProfile] = useState({
      commercialName: '',
      legalName: '',
      phone: '',
      email: '',
      line1: '',
      city: '',
      region: '',
      postalCode: '',
      countryCode: 'MX',
    }),
    [hours, setHours] = useState<
      Array<{ day: number; closed: boolean; open: string | null; close: string | null }>
    >([]),
    [logo, setLogo] = useState<RestaurantAdministrationState['businessProfile']['logo']>(null),
    [policy, setPolicy] = useState({
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      rollover: '04:00',
      currency: 'MXN',
    }),
    [register, setRegister] = useState({ name: 'Caja principal', blindCashCount: true }),
    [station, setStation] = useState({ name: 'Cocina', purpose: 'KITCHEN' }),
    [zone, setZone] = useState('Salón'),
    [table, setTable] = useState({ name: 'Mesa 1', capacity: '4', zoneId: '' }),
    [taxForm, setTaxForm] = useState({ name: 'IVA', rate: '16', mode: 'TAX_INCLUDED' as const }),
    [person, setPerson] = useState({
      displayName: '',
      pin: '',
      role: 'CASHIER' as 'OWNER' | 'MANAGER' | 'CASHIER' | 'WAITER' | 'KITCHEN',
    }),
    [assignment, setAssignment] = useState({ productId: '', stationId: '', version: 0 }),
    [productForm, setProductForm] = useState({ name: '', amount: '', taxProfileId: '' });
  useEffect(() => {
    const previousPending = drafts.pendingKeys.join('|');
    drafts.observe('profile', 'business-profile', { profile, hours, logo }, profileVersion);
    drafts.observe(
      'day',
      'day-currency',
      { timeZone: policy.timeZone, rollover: policy.rollover },
      dayVersion,
    );
    drafts.observe('currency', 'day-currency', policy.currency, currencyVersion);
    drafts.observe('register', 'registers', register, 0);
    drafts.observe('station', 'stations', station, 0);
    drafts.observe('assignment', 'stations', assignment, assignment.version);
    drafts.observe('zone', 'zones-tables', zone, 0);
    drafts.observe('table', 'zones-tables', table, 0);
    drafts.observe('tax', 'taxes', taxForm, 0);
    drafts.observe('product', 'taxes', productForm, 0);
    drafts.observe('person', 'personnel', person, 0);
    if (previousPending !== drafts.pendingKeys.join('|')) setDraftTick(x => x + 1);
  }, [
    profile,
    hours,
    logo,
    profileVersion,
    policy,
    dayVersion,
    currencyVersion,
    register,
    station,
    assignment,
    zone,
    table,
    taxForm,
    productForm,
    person,
    drafts,
    draftTick,
  ]);
  async function load(fresh = false) {
    const sequence = ++loadSequence.current;
    setBusy(true);
    try {
      const result = await resourcesCache.load(edge, activeSection, permissions, fresh);
      if (sequence !== loadSequence.current) return;
      if (result.denied) {
        setResourceErrors({ access: getUserGuidance('PERMISSION_DENIED').explanation });
        return;
      }
      const resources = result.resources;
      const errors: Record<string, string> = {};
      for (const [key, result] of Object.entries(resources))
        if (result.status === 'error')
          errors[key] = administrationErrorGuidance(result.error).explanation;
      setResourceErrors(errors);
      if (Object.keys(errors).length === 0) setReconciliationPending(false);
      const a = resources.admin?.status === 'ready' ? resources.admin.value : null;
      if (a) {
        setAdmin(a);
        drafts.refresh('profile', () => {
          setProfile({
            commercialName: a.businessProfile.commercialName ?? '',
            legalName: a.businessProfile.legalName ?? '',
            phone: a.businessProfile.phone ?? '',
            email: a.businessProfile.email ?? '',
            line1: a.businessProfile.address.line1,
            city: a.businessProfile.address.city,
            region: a.businessProfile.address.region,
            postalCode: a.businessProfile.address.postalCode,
            countryCode: a.businessProfile.address.countryCode ?? 'MX',
          });
          setHours(a.businessProfile.operatingHours);
          setLogo(a.businessProfile.logo);
          setProfileVersion(a.businessProfile.version);
        });
        setPolicy((current) => ({
          ...current,
          ...(!drafts.has('day')
            ? {
                timeZone:
                  a.operational.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
                rollover: a.operational.rollover ?? '04:00',
              }
            : {}),
          ...(!drafts.has('currency') ? { currency: a.operational.currency ?? 'MXN' } : {}),
        }));
        if (!drafts.has('day')) setDayVersion(a.operational.version);
        if (!drafts.has('currency')) setCurrencyVersion(a.operational.version);
        if (!drafts.has('table'))
          setTable((x) => ({ ...x, zoneId: a.zones.find((z) => z.active)?.id ?? '' }));
      }
      if (resources.tax?.status === 'ready') {
        const currentTax = resources.tax.value;
        setTax(currentTax);
        if (!drafts.has('assignment'))
          setAssignment((current) => ({
            ...current,
            version: currentTax.products.find((row) => row.id === current.productId)?.version ?? 0,
          }));
      }
      if (resources.people?.status === 'ready') setPeople(resources.people.value);
      if (resources.products?.status === 'ready') setProducts(resources.products.value);
      if (resources.configuration?.status === 'ready')
        setConfiguration(resources.configuration.value);
      if (fresh && Object.keys(errors).length === 0)
        setConflicts((current) =>
          Object.fromEntries(
            Object.entries(current).map(([key, entry]) => [
              key,
              entry.section === activeSection ? { ...entry, consulted: true } : entry,
            ]),
          ),
        );
    } finally {
      if (sequence === loadSequence.current) {
        setBusy(false);
        setLoaded(true);
      }
    }
  }
  useEffect(() => {
    setLoaded(false);
    setError(null);
    setErrorGuidance(null);
    setNotice('');
    void load();
    return () => {
      loadSequence.current++;
    };
  }, [activeSection, permissions]);
  async function run(work: () => Promise<unknown>, ok: string, savedDraft?: string) {
    if (reconciliationPending) return;
    let acknowledged = false;
    const submittedEdit = takeEditSubmission();
    setBusy(true);
    setError(null);
    setErrorGuidance(null);
    setNotice('');
    if (savedDraft) drafts.saving(savedDraft, true);
    try {
      await work();
      acknowledged = true;
      setReconciliationPending(true);
      if (submittedEdit) clearEdit();
      setReadiness(null);
      if (savedDraft) clearConflict(savedDraft);
      else if (submittedEdit) clearConflict('edit:' + activeSection);
      drafts.saved(savedDraft);
      if (savedDraft?.startsWith('choice:')) discardChoice(savedDraft);
      setDraftTick((x) => x + 1);
      setNotice(ok);
      if (savedDraft === 'person') setPerson((x) => ({ ...x, pin: '' }));
      resourcesCache.invalidate();
      await load();
    } catch (e) {
      const guidance = administrationErrorGuidance(e);
      setError(acknowledged ? `El cambio fue confirmado. Falta consultar su estado: ${guidance.explanation}` : guidance.explanation);
      setErrorGuidance(guidance);
      if (
        !acknowledged && e instanceof EdgeClientError &&
        [
          'ADMINISTRATION_VERSION_CONFLICT',
          'PERSONNEL_VERSION_CONFLICT',
          'USER_SECURITY_REVISION_CONFLICT',
          'CONFIGURATION_REVISION_CONFLICT',
          'DOMAIN_CONFLICT',
          'TAX_REVISION_INCONSISTENT',
        ].includes(e.code)
      ) {
        setConflicts((current) => ({
          ...current,
          [savedDraft ?? 'edit:' + activeSection]: {
            section: activeSection,
            draft: savedDraft ?? null,
            consulted: false,
          },
        }));
        for (const key of savedDraft ? [savedDraft] : drafts.keys(activeSection))
          drafts.conflict(key);
      }
    } finally {
      if (savedDraft) drafts.saving(savedDraft, false);
      setBusy(false);
    }
  }
  const close = async () => {
    if (busy || dialogOpen || pinRequest) return;
    if (
      (!drafts.dirty && !lastEdit) ||
      (await confirm('Hay cambios sin guardar. ¿Cerrar Administración y descartarlos?'))
    )
      onClose();
  };
  const reason = 'Actualización explícita desde Administración POS';
  const registerCreationIssue = cashRegisterCreationIssue(
    admin?.operational.currency ?? null,
    register.name,
  );
  const confirmDeactivate = (label: string) =>
    confirm(
      `Desactivar ${label} puede impedir nuevas operaciones y conserva su historial. Los demás borradores se conservarán. ¿Continuar?`,
    );
  const changeRoles = async (user: PersonnelList['users'][number]) => {
    const raw = await ask('Roles', user.roles.join(', '), user.userId);
    if (!raw) return;
    const roles = raw
      .split(',')
      .map((x) => x.trim().toUpperCase())
      .filter(Boolean) as Array<'OWNER' | 'MANAGER' | 'CASHIER' | 'WAITER' | 'KITCHEN'>;
    void run(
      () =>
        edge.executePersonnel({
          kind: 'CHANGE_AUTHORIZATION',
          commandId: commandId(),
          userId: user.userId,
          expectedVersion: user.version,
          reason,
          roles,
        }),
      'Roles actualizados; las sesiones anteriores quedaron invalidadas.',
    );
  };
  const tipPolicy = configuration?.tipPolicy,
    effectiveTipPercentages = tipPolicy?.allowPercentages
      ? (admin?.operational.tipPreferences?.percentageOptionsBasisPoints ??
        tipPolicy.allowedPercentagesBasisPoints)
      : (configuration?.payment.tipPercentageOptionsBasisPoints ?? []);
  const permitted = canOpenAdminSection(activeSection, permissions);
  return {
    reconciliationPending,
    choices,
    choose,
    discardChoice,
    readiness,
    consultReadiness,
    edge,
    currentUserId,
    permissions,
    admin,
    tax,
    people,
    configuration,
    products,
    error,
    errorGuidance,
    notice,
    busy,
    drafts,
    markDirty,
    activeSection,
    section,
    ask,
    confirm,
    dialogs,
    dialogOpen,
    lastEdit,
    clearEdit,
    conflict,
    setConflict,
    conflictConsulted,
    conflictDraft,
    loaded,
    resourceErrors,
    profileVersion,
    setProfileVersion,
    dayVersion,
    setDayVersion,
    currencyVersion,
    setCurrencyVersion,
    pinRequest,
    setPinRequest,
    capturePin,
    showLocalError,
    profile,
    setProfile,
    hours,
    setHours,
    logo,
    setLogo,
    policy,
    setPolicy,
    register,
    setRegister,
    station,
    setStation,
    zone,
    setZone,
    table,
    setTable,
    taxForm,
    setTaxForm,
    person,
    setPerson,
    assignment,
    setAssignment,
    productForm,
    setProductForm,
    load,
    run,
    close,
    navigate,
    reason,
    registerCreationIssue,
    confirmDeactivate,
    changeRoles,
    tipPolicy,
    effectiveTipPercentages,
    permitted,
  };
}
