import type { ReactNode } from 'react';
import {
  Button,
  Dialog,
  InlineAlert,
  StatusBadge,
  PrerequisiteNotice,
  prerequisite,
  getUserGuidance,
  navigationTarget,
  type TypedNavigationTarget,
} from '@comanview/ui';
import type {
  RestaurantAdministrationState,
  PersonnelList,
  InstallationReadiness,
} from '@comanview/contracts';
import { ADMIN_SECTIONS, canOpenAdminSection, type AdminSectionId } from './administrationModel.js';
import { readinessPrerequisite } from './deviceAdmin.js';

export function AdministrationShell({
  section,
  permissions,
  busy,
  dirtySections,
  onNavigate,
  onClose,
  children,
}: {
  section: AdminSectionId;
  permissions: readonly string[];
  busy: boolean;
  dirtySections: readonly AdminSectionId[];
  onNavigate(target: TypedNavigationTarget): void;
  onClose(): void;
  children: ReactNode;
}) {
  return (
    <Dialog
      open
      title="Tu restaurante"
      description="Configuración y administración local"
      className="administration-shell"
      cancelable={!busy}
      onClose={onClose}
    >
      <header className="admin-shell-toolbar">
        <span><strong>{ADMIN_SECTIONS.find((item) => item.id === section)?.label}</strong> · Los cambios se guardan por apartado.</span>
        <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
          Volver al POS
        </Button>
      </header>
      <div className="admin-shell-layout">
        <nav aria-label="Administración del restaurante" className="admin-shell-navigation">
          {['Restaurante', 'Operación', 'Equipo'].map((group) => {
            const items = ADMIN_SECTIONS.filter(
              (item) => item.group === group && canOpenAdminSection(item.id, permissions),
            );
            return items.length ? (
              <div key={group}>
                <h3>{group}</h3>
                {items.map((item) => (
                  <Button
                    type="button"
                    variant="ghost"
                    key={item.id}
                    aria-current={section === item.id ? 'page' : undefined}
                    disabled={busy}
                    onClick={() => onNavigate(navigationTarget.administration(item.id))}
                  >
                    {item.label}
                    {dirtySections.includes(item.id) ? (
                      <span aria-label="Cambios sin guardar"> •</span>
                    ) : null}
                  </Button>
                ))}
              </div>
            ) : null;
          })}
          {permissions.includes('DEVICE_VIEW') && (
            <div>
              <h3>Sistema</h3>
              {(
                [
                  { section: 'devices', label: 'Dispositivos' },
                  { section: 'readiness', label: 'Estado de instalación' },
                  { section: 'backup-recovery', label: 'Copias y recuperación' },
                ] as const
              ).map((item) => (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  key={item.section}
                  onClick={() => onNavigate(navigationTarget.system(item.section))}
                >
                  {item.label}
                </Button>
              ))}
            </div>
          )}
        </nav>
        <main className="administration-content" aria-busy={busy}>
          {children}
        </main>
      </div>
    </Dialog>
  );
}

export function PrerequisiteSummary({
  admin,
  people,
  permissions,
  readiness,
  onReadiness,
  onNavigate,
}: {
  admin: RestaurantAdministrationState | null;
  people: PersonnelList | null;
  permissions: readonly string[];
  readiness: InstallationReadiness | null;
  onReadiness(): void;
  onNavigate(target: TypedNavigationTarget): void;
}) {
  const checks: { label: string; complete: boolean; section: AdminSectionId; detail: string }[] =
    [];
  if (admin) {
    checks.push(
      {
        label: 'Perfil del negocio',
        complete: admin.businessProfile.confirmed,
        section: 'business-profile',
        detail: 'Confirma el nombre y los datos del restaurante.',
      },
      {
        label: 'Moneda',
        complete: Boolean(admin.operational.currency),
        section: 'day-currency',
        detail: 'Define la moneda antes de crear cajas o registrar ventas.',
      },
      {
        label: 'Día de negocio',
        complete: Boolean(admin.operational.timeZone && admin.operational.rollover),
        section: 'day-currency',
        detail: 'Define la zona horaria y el inicio de la jornada.',
      },
      {
        label: 'Impuesto predeterminado',
        complete: Boolean(admin.operational.defaultTaxProfileId),
        section: 'taxes',
        detail: 'Elige un impuesto activo como predeterminado.',
      },
      {
        label: 'Caja predeterminada',
        complete: Boolean(
          admin.cashRegisters.find(
            (row) => row.active && row.id === admin.operational.defaultCashRegisterId,
          ),
        ),
        section: 'registers',
        detail: 'Crea o selecciona una caja activa.',
      },
    );
  }
  if (people)
    checks.push({
      label: 'Personal',
      complete:
        !people.ownerRecoveryRequired && people.users.some((user) => user.status === 'ACTIVE'),
      section: 'personnel',
      detail: 'Revisa que el personal esté activo y autorizado.',
    });
  const pending = checks.filter((item) => !item.complete);
  return (
    <details
      className="admin-checklist"
      key={pending.length ? 'pending' : 'complete'}
      open={pending.length > 0}
    >
      <summary>
        Preparación del restaurante · {checks.length - pending.length}/{checks.length} verificados
      </summary>
      <p>Configuración guardada consultada en Edge. Puedes navegar libremente; los borradores aún no cuentan como completos.</p>
      {pending.length ? (
        <><p><strong>Siguiente recomendado: {pending[0]!.label}</strong></p>{pending.slice(0,1).map((item) => (
          <PrerequisiteNotice
            key={item.label}
            state={prerequisite({
              key: item.section,
              label: item.label,
              status: 'missing',
              guidance: getUserGuidance('ADMINISTRATION_CONFIGURATION_REQUIRED', {
                title: `${item.label} pendiente`,
                explanation: item.detail,
                severity: 'warning',
                retryability: 'after-action',
                action: {
                  label: `Configurar ${item.label.toLowerCase()}`,
                  target: navigationTarget.administration(item.section),
                },
              }),
              authority: { source: 'edge' },
            })}
            onAction={onNavigate}
          />
        ))}<details><summary>Ver los otros {Math.max(0,pending.length-1)} pendientes y lo ya guardado</summary>
          <ul>{checks.map(item=><li key={item.label}>
            <strong>{item.complete ? 'Guardado' : 'Pendiente'} · {item.label}</strong>
            {!item.complete && <><p>{item.detail}</p><Button type="button" variant="ghost" onClick={()=>onNavigate(navigationTarget.administration(item.section))}>Ir a {item.label.toLowerCase()}</Button></>}
          </li>)}</ul>
        </details></>
      ) : checks.length ? (
        <StatusBadge tone="success">Configuración consultada completa</StatusBadge>
      ) : null}
      {permissions.includes('DEVICE_VIEW') && (
        <Button type="button" variant="secondary" onClick={onReadiness}>
          Consultar preparación completa
        </Button>
      )}
      {readiness && (
        <div>
          <p>
            La preparación completa también verifica dispositivos, estaciones requeridas y
            protección de las copias.
          </p>
          {readiness.components
            .filter((item) => item.key !== 'ADMINISTRATION')
            .map((component) => (
              <PrerequisiteNotice
                key={component.key}
                state={readinessPrerequisite(component, (target) =>
                  target.surface === 'system'
                    ? permissions.includes('DEVICE_VIEW')
                    : canOpenAdminSection(target.section, permissions),
                )}
                onAction={onNavigate}
              />
            ))}
          <StatusBadge tone={readiness.productionReadiness === 'READY' ? 'success' : 'warning'}>
            {readiness.productionReadiness === 'READY'
              ? 'Preparación verificada'
              : 'Hay requisitos de instalación pendientes'}
          </StatusBadge>
        </div>
      )}
    </details>
  );
}
