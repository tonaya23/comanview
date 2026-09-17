import {
  Button,
  InlineAlert,
  TechnicalDetails,
  getUserGuidance,
  guidanceTone,
} from '@comanview/ui';
import { AdministrationShell, PrerequisiteSummary } from './AdministrationShell.js';
import { ActiveAdministrationSection } from './AdministrationSections.js';
import {
  useAdministrationController,
  type AdministrationProps,
} from './useAdministrationController.js';
import { PersonnelPinDialog } from './PersonnelPinDialog.js';
export {
  CashRegisterCreateAction,
  cashRegisterCreationIssue,
  administrationErrorMessage,
  administrationErrorGuidance,
} from './AdministrationFields.js';

export function AdministrationPanel(props: AdministrationProps) {
  const state = useAdministrationController(props);
  const {
    permissions,
    admin,
    people,
    error,
    errorGuidance,
    notice,
    busy,
    drafts,
    markDirty,
    activeSection,
    section,
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
    setProfileVersion,
    setDayVersion,
    setCurrencyVersion,
    pinRequest,
    setPinRequest,
    profile,
    setRegister,
    setStation,
    setZone,
    setTable,
    setTaxForm,
    setPerson,
    setAssignment,
    setProductForm,
    load,
    close,
    navigate,
    permitted,
  } = state;
  return (
    <AdministrationShell
      section={activeSection}
      permissions={permissions}
      busy={busy}
      dirtySections={[
        ...new Set(
          drafts.pendingKeys.flatMap((key) => (drafts.get(key) ? [drafts.get(key)!.section] : [])),
        ),
      ]}
      onNavigate={(target) => void navigate(target)}
      onClose={() => void close()}
    >
      <PrerequisiteSummary
        admin={permissions.includes('ADMINISTRATION_VIEW') ? admin : null}
        people={permissions.includes('PERSONNEL_VIEW') ? people : null}
        permissions={permissions}
        readiness={state.readiness}
        onReadiness={() => void state.consultReadiness()}
        onNavigate={(target) => void navigate(target)}
      />
      <div
        onChangeCapture={(e) => {
          const key = (e.target as HTMLElement).closest('[data-draft]')?.getAttribute('data-draft');
          if (key) markDirty(key);
        }}
      >
        {error && !conflict && (
          <InlineAlert
            tone={errorGuidance ? guidanceTone(errorGuidance) : 'error'}
            title={errorGuidance?.title}
            urgent
          >
            {error}
            {errorGuidance?.action ? (
              <Button type="button" onClick={() => navigate(errorGuidance.action!.target)}>
                {errorGuidance.action.label}
              </Button>
            ) : null}
          </InlineAlert>
        )}
        {notice && !error && !conflict && !drafts.dirty && !state.reconciliationPending && <InlineAlert tone="success">{notice}</InlineAlert>}
        {state.reconciliationPending && !busy && <InlineAlert tone="warning" title="Guardado confirmado; consulta pendiente">
          No repitas el cambio. Consulta el estado guardado antes de realizar otra operación.
          <Button type="button" onClick={()=>void load(true)}>Consultar guardado</Button>
        </InlineAlert>}
        <p className="administration-hint">
          {drafts.dirty
            ? 'Hay borradores sin guardar. Puedes cambiar de apartado sin perderlos; guárdalos antes de salir.'
            : 'Los cambios se aplican al pulsar el botón de guardar de cada apartado.'}
        </p>
        {Object.entries(resourceErrors).map(([key, text]) => (
          <InlineAlert key={key} tone="error" urgent>
            {text}{' '}
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => void load(true)}
            >
              Reintentar
            </Button>
          </InlineAlert>
        ))}
        <div className="admin-section-toolbar">
          {!conflict && (lastEdit || Object.keys(resourceErrors).length > 0) && (
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void load(true)}>
              Actualizar sección
            </Button>
          )}
          {drafts.keys(activeSection).some((key) => drafts.has(key)) && (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={async () => {
                if (
                  await confirm(
                    'Se descartarán solamente los cambios pendientes de este apartado y se consultará la configuración guardada. ¿Continuar?',
                  )
                ) {
                  for (const key of drafts.keys(activeSection)) {
                    drafts.saved(key);
                    if (key.startsWith('choice:')) state.discardChoice(key);
                  }
                  if (activeSection === 'registers')
                    setRegister({ name: 'Caja principal', blindCashCount: true });
                  if (activeSection === 'stations') {
                    setStation({ name: 'Cocina', purpose: 'KITCHEN' });
                    setAssignment({ productId: '', stationId: '', version: 0 });
                  }
                  if (activeSection === 'zones-tables') {
                    setZone('Salón');
                    setTable({
                      name: 'Mesa 1',
                      capacity: '4',
                      zoneId: admin?.zones.find((z) => z.active)?.id ?? '',
                    });
                  }
                  if (activeSection === 'taxes') {
                    setTaxForm({ name: 'IVA', rate: '16', mode: 'TAX_INCLUDED' });
                    setProductForm({ name: '', amount: '', taxProfileId: '' });
                  }
                  if (activeSection === 'personnel')
                    setPerson({ displayName: '', pin: '', role: 'CASHIER' });
                  setConflict(false);
                  await load(true);
                }
              }}
            >
              Descartar borrador de este apartado
            </Button>
          )}
        </div>
        {lastEdit && !busy && !dialogOpen && !conflict && (
          <InlineAlert tone="warning" title="Edición pendiente">
            <p>
              {lastEdit.label}: {lastEdit.value}
            </p>
            <p>
              Actualiza la lista y vuelve a abrir la edición del mismo elemento para aplicar este
              valor sobre su estado actual.
            </p>
            <Button type="button" variant="ghost" onClick={clearEdit}>
              Descartar esta edición
            </Button>
          </InlineAlert>
        )}
        {conflict && (
          <InlineAlert tone="warning" title="La configuración cambió" urgent>
            Tu intención local se conserva. Consulta el estado actual antes de volver a guardar.
            {lastEdit && <p><strong>Edición pendiente</strong><br/>{lastEdit.label}: {lastEdit.value}</p>}
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => void load(true)}
            >
              Consultar estado actual
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={
                busy ||
                !conflictConsulted ||
                !conflictDraft ||
                !['profile', 'day', 'currency'].includes(conflictDraft)
              }
              onClick={async () => {
                if (
                  await confirm(
                    'Revisa los datos actuales. Usar esta base conservará tu borrador y permitirá enviarlo sobre la versión consultada.',
                  )
                ) {
                  if (admin) {
                    if (conflictDraft)
                      drafts.rebase(
                        conflictDraft,
                        conflictDraft === 'profile'
                          ? admin.businessProfile.version
                          : admin.operational.version,
                      );
                    if (activeSection === 'business-profile')
                      setProfileVersion(admin.businessProfile.version);
                    if (conflictDraft === 'day') setDayVersion(admin.operational.version);
                    if (conflictDraft === 'currency') setCurrencyVersion(admin.operational.version);
                  }
                  setConflict(false);
                }
              }}
            >
              Usar la base consultada
            </Button>
            <TechnicalDetails>
              <pre>
                {JSON.stringify(
                  activeSection === 'business-profile'
                    ? {
                        commercialName: admin?.businessProfile.commercialName,
                        version: admin?.businessProfile.version,
                      }
                    : activeSection === 'day-currency'
                      ? admin?.operational
                      : { message: 'Actualiza la lista y vuelve a abrir la edición afectada.' },
                  null,
                  2,
                )}
              </pre>
            </TechnicalDetails>
          </InlineAlert>
        )}
        {!loaded ? (
          <InlineAlert>Cargando sección…</InlineAlert>
        ) : !permitted ? (
          <InlineAlert tone="warning" urgent>
            {getUserGuidance('PERMISSION_DENIED').explanation}
          </InlineAlert>
        ) : (
          <div className="administration-grid" inert={busy || state.reconciliationPending} aria-busy={busy}>
            <ActiveAdministrationSection state={state} />
          </div>
        )}
      </div>
      {dialogs}
      {pinRequest && (
        <PersonnelPinDialog
          requireCurrent={pinRequest.requireCurrent}
          onCancel={() => setPinRequest(null)}
          onSubmit={(values) => {
            const request = pinRequest;
            setPinRequest(null);
            request.submit(values);
          }}
        />
      )}
    </AdministrationShell>
  );
}
