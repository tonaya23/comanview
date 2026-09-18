import type { FormEvent, ReactNode } from 'react';
import { useRef } from 'react';
import {
  Button,
  Select,
  TimeZoneField,
  CurrencyField,
  BusinessCutoffField,
  InlineAlert,
  PrerequisiteNotice,
  TechnicalDetails,
  prerequisite,
  getUserGuidance,
} from '@comanview/ui';
import {
  SelectField,
  roleLabel,
  Field,
  CashRegisterCreateAction,
  nullable,
  readLogo,
  administrationErrorMessage as message,
} from './AdministrationFields.js';
import { StationFunctionField, stationFunctionLabel } from './AdministrationDialogs.js';
import { validPersonnelPin } from './PersonnelPinDialog.js';
import { parseMoneyInputToMinorUnits } from './posLogic.js';
import type { useAdministrationController } from './useAdministrationController.js';
type Context = ReturnType<typeof useAdministrationController>;
const commandId = () => crypto.randomUUID();
function EditPermission({
  state,
  permission,
  children,
}: {
  state: Context;
  permission: string;
  children: ReactNode;
}) {
  const allowed = state.permissions.includes(permission);
  return (
    <>
      {!allowed && (
        <InlineAlert tone="info">
          Puedes consultar este apartado. Para modificarlo necesitas un rol con permiso de
          administración de esta configuración.
        </InlineAlert>
      )}
      <fieldset className="admin-edit-scope" disabled={!allowed}>
        {children}
      </fieldset>
    </>
  );
}
export function ActiveAdministrationSection({ state }: { state: Context }) {
  switch (state.activeSection) {
    case 'business-profile':
      return (
        <EditPermission state={state} permission="BUSINESS_PROFILE_MANAGE">
          <BusinessSection state={state} />
        </EditPermission>
      );
    case 'day-currency':
      return <DayCurrencySection state={state} />;
    case 'registers':
      return (
        <EditPermission state={state} permission="CASH_REGISTER_MANAGE">
          <RegistersSection state={state} />
        </EditPermission>
      );
    case 'stations':
      return (
        <EditPermission state={state} permission="STATION_MANAGE">
          <StationsSection state={state} />
        </EditPermission>
      );
    case 'zones-tables':
      return (
        <EditPermission state={state} permission="TABLE_MANAGE">
          <ZonesTablesSection state={state} />
        </EditPermission>
      );
    case 'taxes':
      return (
        <EditPermission state={state} permission="TAX_PROFILE_MANAGE">
          <TaxSection state={state} />
        </EditPermission>
      );
    case 'tips':
      return (
        <EditPermission state={state} permission="TIP_PREFERENCES_MANAGE">
          <TipsSection state={state} />
        </EditPermission>
      );
    case 'personnel':
      return <PersonnelSection state={state} />;
  }
}

function BusinessSection({ state }: { state: Context }) {
  const {
    edge,
    admin,
    busy,
    markDirty,
    profileVersion,
    showLocalError,
    profile,
    setProfile,
    hours,
    setHours,
    logo,
    setLogo,
    run,
    close,
    reason,
  } = state;
  if (!admin) return null;
  return (
    <form
      data-draft="profile"
      onSubmit={(e) => {
        e.preventDefault();
        void run(
          () =>
            edge.executeRestaurantAdministration({
              kind: 'UPDATE_BUSINESS_PROFILE',
              commandId: commandId(),
              expectedVersion: profileVersion,
              reason,
              commercialName: profile.commercialName,
              legalName: nullable(profile.legalName),
              phone: nullable(profile.phone),
              email: nullable(profile.email),
              address: {
                line1: profile.line1,
                line2: admin.businessProfile.address.line2,
                city: profile.city,
                region: profile.region,
                postalCode: profile.postalCode,
                countryCode: profile.countryCode ? profile.countryCode.toUpperCase() : null,
              },
              operatingHours: hours,
              logo,
              confirmed: true,
            }),
          'Perfil confirmado.',
          'profile',
        );
      }}
    >
      <h3>Negocio</h3>
      <Field
        label="Nombre comercial"
        value={profile.commercialName}
        set={(v) => setProfile({ ...profile, commercialName: v })}
      />
      <Field
        label="Razón social (privada)"
        value={profile.legalName}
        set={(v) => setProfile({ ...profile, legalName: v })}
      />
      <Field
        label="Teléfono"
        value={profile.phone}
        set={(v) => setProfile({ ...profile, phone: v })}
      />
      <Field
        label="Email"
        value={profile.email}
        set={(v) => setProfile({ ...profile, email: v })}
      />
      <Field
        label="Dirección"
        value={profile.line1}
        set={(v) => setProfile({ ...profile, line1: v })}
      />
      <Field label="Ciudad" value={profile.city} set={(v) => setProfile({ ...profile, city: v })} />
      <Field
        label="Estado/región"
        value={profile.region}
        set={(v) => setProfile({ ...profile, region: v })}
      />
      <Field
        label="Código postal"
        value={profile.postalCode}
        set={(v) => setProfile({ ...profile, postalCode: v })}
      />
      <div className="restaurant-logo-upload">
        {logo ? (
          <img
            src={`data:${logo.mime};base64,${logo.base64}`}
            alt="Vista previa del logo del restaurante"
          />
        ) : (
          <div className="restaurant-logo-placeholder" aria-hidden="true">
            Tu logo
          </div>
        )}
        <div>
          <label>
            Logo del restaurante
            <input
              type="file"
              accept="image/png,image/jpeg"
              aria-describedby="restaurant-logo-help"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file)
                  void readLogo(file)
                    .then(setLogo)
                    .catch((x) => showLocalError(message(x)));
                e.target.value = '';
              }}
            />
          </label>
          <small id="restaurant-logo-help">
            Elige una imagen PNG o JPG. Hasta 1 MiB y 2048 × 2048 píxeles. Se guardará con el
            perfil.
          </small>
          {logo && (
            <Button
              type="button"
              onClick={async () => {
                setLogo(null);
                markDirty('profile');
              }}
            >
              Quitar logo
            </Button>
          )}
        </div>
      </div>
      <details>
        <summary>Horarios de atención</summary>
        {['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map((name, day) => {
          const value = hours.find((x) => x.day === day) ?? {
            day,
            closed: true,
            open: null,
            close: null,
          };
          const update = (next: typeof value) =>
            setHours([...hours.filter((x) => x.day !== day), next].sort((a, b) => a.day - b.day));
          return (
            <div key={day}>
              <label>
                <input
                  type="checkbox"
                  checked={!value.closed}
                  onChange={(e) =>
                    update({
                      ...value,
                      closed: !e.target.checked,
                      open: e.target.checked ? (value.open ?? '09:00') : null,
                      close: e.target.checked ? (value.close ?? '18:00') : null,
                    })
                  }
                />
                {name}
              </label>
              {!value.closed && (
                <>
                  <label>
                    Apertura {name}
                    <input
                      type="time"
                      value={value.open ?? '09:00'}
                      onChange={(e) => update({ ...value, open: e.target.value })}
                    />
                  </label>
                  <label>
                    Cierre {name}
                    <input
                      type="time"
                      value={value.close ?? '18:00'}
                      onChange={(e) => update({ ...value, close: e.target.value })}
                    />
                  </label>
                </>
              )}
            </div>
          );
        })}
      </details>
      <div className="admin-save-actions"><Button disabled={busy}>Guardar perfil</Button></div>
    </form>
  );
}

function DayCurrencySection({ state }: { state: Context }) {
  const {
    edge,
    admin,
    busy,
    section,
    dayVersion,
    currencyVersion,
    policy,
    setPolicy,
    run,
    navigate,
    reason,
  } = state;
  if (!admin) return null;
  return (
    <section>
      <h3>Día de negocio y moneda</h3>
      {(!admin.operational.timeZone || !admin.operational.rollover) && (
        <PrerequisiteNotice
          state={prerequisite({
            key: 'business-day',
            label: 'Día de negocio',
            status: 'missing',
            guidance: getUserGuidance('BUSINESS_DAY_POLICY_REQUIRED'),
            authority: { source: 'edge' },
          })}
          onAction={navigate}
        />
      )}
      <EditPermission state={state} permission="BUSINESS_DAY_POLICY_MANAGE">
        <div data-draft="day">
          <TimeZoneField
            value={policy.timeZone}
            onChange={(v) => setPolicy({ ...policy, timeZone: v })}
          />
          <BusinessCutoffField
            value={policy.rollover}
            onChange={(v) => setPolicy({ ...policy, rollover: v })}
          />
          <Button
            disabled={busy}
            onClick={() =>
              void run(
                () =>
                  edge.executeRestaurantAdministration({
                    kind: 'SET_BUSINESS_DAY_POLICY',
                    commandId: commandId(),
                    expectedVersion: dayVersion,
                    reason,
                    timeZone: policy.timeZone,
                    rollover: policy.rollover,
                  }),
                'Política de día guardada.',
                'day',
              )
            }
          >
            Guardar día de negocio
          </Button>
        </div>
      </EditPermission>
      <EditPermission state={state} permission="CURRENCY_MANAGE">
        <div data-draft="currency">
          <CurrencyField
            value={policy.currency}
            disabled={busy || admin.operational.currencyLocked}
            onChange={(v) => setPolicy({ ...policy, currency: v })}
          />
          <Button
            disabled={busy || admin.operational.currencyLocked}
            onClick={() =>
              void run(
                () =>
                  edge.executeRestaurantAdministration({
                    kind: 'SET_CURRENCY',
                    commandId: commandId(),
                    expectedVersion: currencyVersion,
                    reason,
                    currency: policy.currency,
                  }),
                'Moneda guardada.',
                'currency',
              )
            }
          >
            Establecer moneda
          </Button>
        </div>
      </EditPermission>
      {admin.operational.currencyLocked && <p>Moneda bloqueada por actividad financiera.</p>}
    </section>
  );
}

function RegistersSection({ state }: { state: Context }) {
  const {
    edge,
    admin,
    busy,
    ask,
    showLocalError,
    register,
    setRegister,
    run,
    navigate,
    reason,
    registerCreationIssue,
    confirmDeactivate,
  } = state;
  if (!admin) return null;
  return (
    <form
      data-draft="register"
      onSubmit={(e) => {
        e.preventDefault();
        if (registerCreationIssue) {
          showLocalError(registerCreationIssue);
          return;
        }
        void run(
          () =>
            edge.executeRestaurantAdministration({
              kind: 'CREATE_CASH_REGISTER',
              commandId: commandId(),
              expectedVersion: 0,
              reason,
              name: register.name,
              blindCashCount: register.blindCashCount,
              makeDefault: true,
              displayOrder: admin.cashRegisters.length * 10,
            }),
          'Caja creada.',
          'register',
        );
      }}
    >
      <h3>Cajas</h3>
      <ul>
        {admin.cashRegisters.map((x) => (
          <li key={x.id}>
            {x.name} · {x.currency} · {x.active ? 'activa' : 'inactiva'}{' '}
            {admin.operational.defaultCashRegisterId === x.id ? '(predeterminada)' : ''}
            <Button
              type="button"
              disabled={busy}
              onClick={async () => {
                const name = await ask('Nombre de caja', x.name, x.id);
                if (name)
                  void run(
                    () =>
                      edge.executeRestaurantAdministration({
                        kind: 'UPDATE_CASH_REGISTER',
                        commandId: commandId(),
                        expectedVersion: x.version,
                        reason,
                        cashRegisterId: x.id,
                        name,
                        active: x.active,
                        blindCashCount: x.blindCashCount,
                        makeDefault: admin.operational.defaultCashRegisterId === x.id,
                        displayOrder: x.displayOrder,
                      }),
                    'Caja renombrada.',
                  );
              }}
            >
              Renombrar
            </Button>
            <Button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(
                  () =>
                    edge.executeRestaurantAdministration({
                      kind: 'UPDATE_CASH_REGISTER',
                      commandId: commandId(),
                      expectedVersion: x.version,
                      reason,
                      cashRegisterId: x.id,
                      name: x.name,
                      active: x.active,
                      blindCashCount: !x.blindCashCount,
                      makeDefault: admin.operational.defaultCashRegisterId === x.id,
                      displayOrder: x.displayOrder,
                    }),
                  'Política de conteo actualizada.',
                )
              }
            >
              {x.blindCashCount ? 'Conteo visible' : 'Conteo ciego'}
            </Button>
            <Button
              type="button"
              disabled={busy}
              onClick={async () => {
                const order = await ask('Orden de caja', String(x.displayOrder), x.id);
                if (order !== null)
                  void run(
                    () =>
                      edge.executeRestaurantAdministration({
                        kind: 'UPDATE_CASH_REGISTER',
                        commandId: commandId(),
                        expectedVersion: x.version,
                        reason,
                        cashRegisterId: x.id,
                        name: x.name,
                        active: x.active,
                        blindCashCount: x.blindCashCount,
                        makeDefault: admin.operational.defaultCashRegisterId === x.id,
                        displayOrder: Number(order),
                      }),
                    'Orden de caja actualizado.',
                  );
              }}
            >
              Orden
            </Button>
            <Button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(
                  () =>
                    edge.executeRestaurantAdministration({
                      kind: 'UPDATE_CASH_REGISTER',
                      commandId: commandId(),
                      expectedVersion: x.version,
                      reason,
                      cashRegisterId: x.id,
                      name: x.name,
                      active: x.active,
                      blindCashCount: x.blindCashCount,
                      makeDefault: true,
                      displayOrder: x.displayOrder,
                    }),
                  'Caja predeterminada actualizada.',
                )
              }
            >
              Usar
            </Button>
            <Button
              type="button"
              disabled={busy}
              onClick={async () => {
                if (!x.active || (await confirmDeactivate(`la caja ${x.name}`)))
                  void run(
                    () =>
                      edge.executeRestaurantAdministration({
                        kind: 'UPDATE_CASH_REGISTER',
                        commandId: commandId(),
                        expectedVersion: x.version,
                        reason,
                        cashRegisterId: x.id,
                        name: x.name,
                        active: !x.active,
                        blindCashCount: x.blindCashCount,
                        makeDefault: false,
                        displayOrder: x.displayOrder,
                      }),
                    x.active ? 'Caja desactivada.' : 'Caja activada.',
                  );
              }}
            >
              {x.active ? 'Desactivar' : 'Activar'}
            </Button>
          </li>
        ))}
      </ul>
      <Field
        label="Nueva caja"
        value={register.name}
        set={(v) => setRegister({ ...register, name: v })}
      />
      <label>
        <input
          type="checkbox"
          checked={register.blindCashCount}
          onChange={(e) => setRegister({ ...register, blindCashCount: e.target.checked })}
        />{' '}
        Conteo ciego
      </label>
      <CashRegisterCreateAction
        busy={busy}
        issue={registerCreationIssue}
        currencyMissing={!admin.operational.currency}
        onNavigate={navigate}
      />
    </form>
  );
}

function StationsSection({ state }: { state: Context }) {
  const {
    edge,
    admin,
    tax,
    products,
    busy,
    markDirty,
    ask,
    station,
    setStation,
    assignment,
    setAssignment,
    run,
    reason,
    confirmDeactivate,
  } = state;
  if (!admin) return null;
  return (
    <form
      data-draft="station"
      onSubmit={(e) => {
        e.preventDefault();
        void run(
          () =>
            edge.executeRestaurantAdministration({
              kind: 'CREATE_STATION',
              commandId: commandId(),
              expectedVersion: 0,
              reason,
              name: station.name,
              purpose: nullable(station.purpose),
              kdsVisible: true,
              displayOrder: admin.stations.length * 10,
            }),
          'Estación creada.',
          'station',
        );
      }}
    >
      <h3>Estaciones</h3>
      <ul>
        {admin.stations.map((x) => (
          <li key={x.id}>
            {x.name} · {stationFunctionLabel(x.purpose)} · pantalla de cocina{' '}
            {x.kdsVisible ? 'visible' : 'oculta'} · {x.active ? 'activa' : 'inactiva'}
            <Button
              type="button"
              disabled={busy}
              onClick={async () => {
                const name = await ask('Nombre de estación', x.name, x.id);
                if (name)
                  void run(
                    () =>
                      edge.executeRestaurantAdministration({
                        kind: 'UPDATE_STATION',
                        commandId: commandId(),
                        expectedVersion: x.version,
                        reason,
                        stationId: x.id,
                        name,
                        purpose: x.purpose,
                        kdsVisible: x.kdsVisible,
                        active: x.active,
                        displayOrder: x.displayOrder,
                      }),
                    'Estación renombrada.',
                  );
              }}
            >
              Renombrar
            </Button>
            <Button
              type="button"
              disabled={busy}
              onClick={async () => {
                const purpose = await ask('Función de estación', x.purpose ?? '', x.id);
                if (purpose !== null)
                  void run(
                    () =>
                      edge.executeRestaurantAdministration({
                        kind: 'UPDATE_STATION',
                        commandId: commandId(),
                        expectedVersion: x.version,
                        reason,
                        stationId: x.id,
                        name: x.name,
                        purpose,
                        kdsVisible: x.kdsVisible,
                        active: x.active,
                        displayOrder: x.displayOrder,
                      }),
                    'Propósito actualizado.',
                  );
              }}
            >
              Función
            </Button>
            <Button
              type="button"
              disabled={busy}
              onClick={async () => {
                const order = await ask('Orden de estación', String(x.displayOrder), x.id);
                if (order !== null)
                  void run(
                    () =>
                      edge.executeRestaurantAdministration({
                        kind: 'UPDATE_STATION',
                        commandId: commandId(),
                        expectedVersion: x.version,
                        reason,
                        stationId: x.id,
                        name: x.name,
                        purpose: x.purpose,
                        kdsVisible: x.kdsVisible,
                        active: x.active,
                        displayOrder: Number(order),
                      }),
                    'Orden de estación actualizado.',
                  );
              }}
            >
              Orden
            </Button>
            <Button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(
                  () =>
                    edge.executeRestaurantAdministration({
                      kind: 'UPDATE_STATION',
                      commandId: commandId(),
                      expectedVersion: x.version,
                      reason,
                      stationId: x.id,
                      name: x.name,
                      purpose: x.purpose,
                      kdsVisible: !x.kdsVisible,
                      active: x.active,
                      displayOrder: x.displayOrder,
                    }),
                  'Visibilidad en cocina actualizada.',
                )
              }
            >
              Pantalla de cocina
            </Button>
            <Button
              type="button"
              disabled={busy}
              onClick={async () => {
                if (!x.active || (await confirmDeactivate(`la estación ${x.name}`)))
                  void run(
                    () =>
                      edge.executeRestaurantAdministration({
                        kind: 'UPDATE_STATION',
                        commandId: commandId(),
                        expectedVersion: x.version,
                        reason,
                        stationId: x.id,
                        name: x.name,
                        purpose: x.purpose,
                        kdsVisible: x.kdsVisible,
                        active: !x.active,
                        displayOrder: x.displayOrder,
                      }),
                    x.active ? 'Estación desactivada.' : 'Estación activada.',
                  );
              }}
            >
              {x.active ? 'Desactivar' : 'Activar'}
            </Button>
          </li>
        ))}
      </ul>
      <Field label="Nombre" value={station.name} set={(v) => setStation({ ...station, name: v })} />
      <StationFunctionField
        value={station.purpose}
        onChange={(v) => {
          setStation({ ...station, purpose: v });
          markDirty('station');
        }}
      />
      <Button disabled={busy}>Crear estación</Button>
      <div data-draft="assignment">
        <SelectField
          label="Producto a asignar"
          value={assignment.productId}
          onChange={(e) =>
            setAssignment({
              ...assignment,
              productId: e.target.value,
              version: tax?.products.find((row) => row.id === e.target.value)?.version ?? 0,
            })
          }
        >
          <option value="">Producto…</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Estación de preparación"
          value={assignment.stationId}
          onChange={(e) => setAssignment({ ...assignment, stationId: e.target.value, stationVersion:admin.stations.find(s=>s.id===e.target.value)?.version })}
        >
          <option value="">Sin estación</option>
          {admin.stations
            .filter((s) => s.active)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </SelectField>
        <Button
          type="button"
          disabled={busy || !assignment.productId || !tax}
          onClick={async () => {
            const product = tax?.products.find((p) => p.id === assignment.productId);
            if (product)
              void run(
                () =>
                  edge.executeRestaurantAdministration({
                    kind: 'ASSIGN_PRODUCT_STATION',
                    commandId: state.assignmentCommandId('assignment',{...assignment,reason}),
                    expectedVersion: assignment.version,
                    reason,
                    productId: assignment.productId,
                    stationId: assignment.stationId || null,
                    ...(assignment.stationId ? {stationVersion:assignment.stationVersion} : {}),
                  }),
                'Asignación actualizada.',
                'assignment',
              );
          }}
        >
          Asignar producto
        </Button>
        {(!assignment.productId || !tax) && (
          <small role="status">
            Selecciona un producto del catálogo consultado para asignarle una estación.
          </small>
        )}
      </div>
    </form>
  );
}

function ZonesTablesSection({ state }: { state: Context }) {
  const {
    edge,
    admin,
    busy,
    section,
    ask,
    zone,
    setZone,
    table,
    setTable,
    run,
    reason,
    confirmDeactivate,
  } = state;
  if (!admin) return null;
  return (
    <section>
      <h3>Zonas y mesas</h3>
      <form
        data-draft="zone"
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            () =>
              edge.executeRestaurantAdministration({
                kind: 'CREATE_ZONE',
                commandId: commandId(),
                expectedVersion: 0,
                reason,
                name: zone,
                displayOrder: admin.zones.length * 10,
              }),
            'Zona creada.',
            'zone',
          );
        }}
      >
        <Field label="Nueva zona" value={zone} set={setZone} />
        <Button disabled={busy}>Crear zona</Button>
      </form>
      <ul>
        {admin.zones.map((x) => (
          <li key={x.id}>
            {x.name} · orden {x.displayOrder} · {x.active ? 'activa' : 'inactiva'}{' '}
            <Button
              type="button"
              disabled={busy}
              onClick={async () => {
                const name = await ask('Nombre de zona', x.name, x.id);
                if (name)
                  void run(
                    () =>
                      edge.executeRestaurantAdministration({
                        kind: 'UPDATE_ZONE',
                        commandId: commandId(),
                        expectedVersion: x.version,
                        reason,
                        zoneId: x.id,
                        name,
                        active: x.active,
                        displayOrder: x.displayOrder,
                      }),
                    'Zona renombrada.',
                  );
              }}
            >
              Renombrar
            </Button>{' '}
            <Button
              type="button"
              disabled={busy}
              onClick={async () => {
                const order = await ask('Orden', String(x.displayOrder), x.id);
                if (order !== null)
                  void run(
                    () =>
                      edge.executeRestaurantAdministration({
                        kind: 'UPDATE_ZONE',
                        commandId: commandId(),
                        expectedVersion: x.version,
                        reason,
                        zoneId: x.id,
                        name: x.name,
                        active: x.active,
                        displayOrder: Number(order),
                      }),
                    'Orden actualizado.',
                  );
              }}
            >
              Orden
            </Button>{' '}
            <Button
              type="button"
              disabled={busy}
              onClick={async () => {
                if (!x.active || (await confirmDeactivate(`la zona ${x.name}`)))
                  void run(
                    () =>
                      edge.executeRestaurantAdministration({
                        kind: 'UPDATE_ZONE',
                        commandId: commandId(),
                        expectedVersion: x.version,
                        reason,
                        zoneId: x.id,
                        name: x.name,
                        active: !x.active,
                        displayOrder: x.displayOrder,
                      }),
                    x.active ? 'Zona desactivada.' : 'Zona activada.',
                  );
              }}
            >
              {x.active ? 'Desactivar' : 'Activar'}
            </Button>
          </li>
        ))}
      </ul>
      <ul>
        {admin.tables.map((x) => (
          <li key={x.id}>
            {x.name} · {admin.zones.find((z) => z.id === x.zoneId)?.name ?? 'sin zona'} ·{' '}
            {x.capacity ?? '—'} lugares
            <Button
              type="button"
              disabled={busy || !x.zoneId}
              onClick={async () => {
                const name = await ask('Nombre de mesa', x.name, x.id),
                  zoneId = x.zoneId;
                if (name && zoneId)
                  void run(
                    () =>
                      edge.executeRestaurantAdministration({
                        kind: 'UPDATE_TABLE',
                        commandId: commandId(),
                        expectedVersion: x.version,
                        reason,
                        tableId: x.id,
                        zoneId,
                        name,
                        capacity: x.capacity,
                        active: x.active,
                        displayOrder: x.displayOrder,
                      }),
                    'Mesa renombrada.',
                  );
              }}
            >
              Renombrar
            </Button>
            <Button
              type="button"
              disabled={busy || !x.zoneId}
              onClick={async () => {
                const capacity = await ask(
                    'Capacidad (vacío no permitido en edición)',
                    String(x.capacity ?? ''),
                    x.id,
                  ),
                  zoneId = x.zoneId;
                if (capacity && zoneId)
                  void run(
                    () =>
                      edge.executeRestaurantAdministration({
                        kind: 'UPDATE_TABLE',
                        commandId: commandId(),
                        expectedVersion: x.version,
                        reason,
                        tableId: x.id,
                        zoneId,
                        name: x.name,
                        capacity: Number(capacity),
                        active: x.active,
                        displayOrder: x.displayOrder,
                      }),
                    'Capacidad actualizada.',
                  );
              }}
            >
              Capacidad
            </Button>
            <Button
              type="button"
              disabled={busy || !x.zoneId}
              onClick={async () => {
                const order = await ask('Orden de mesa', String(x.displayOrder), x.id),
                  zoneId = x.zoneId;
                if (order !== null && zoneId)
                  void run(
                    () =>
                      edge.executeRestaurantAdministration({
                        kind: 'UPDATE_TABLE',
                        commandId: commandId(),
                        expectedVersion: x.version,
                        reason,
                        tableId: x.id,
                        zoneId,
                        name: x.name,
                        capacity: x.capacity,
                        active: x.active,
                        displayOrder: Number(order),
                      }),
                    'Orden de mesa actualizado.',
                  );
              }}
            >
              Orden
            </Button>
            <SelectField
              label={`Zona de ${x.name}`}
              value={state.choices[`choice:table:${x.id}`]?.value ?? x.zoneId ?? ''}
              disabled={busy}
              onChange={(e) =>
                state.choose(`choice:table:${x.id}`, x.zoneId ?? '', x.version, e.target.value)
              }
            >
              {admin.zones
                .filter((z) => z.active)
                .map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
            </SelectField>
            {state.choices[`choice:table:${x.id}`] && (
              <>
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    const key = `choice:table:${x.id}`,
                      selection = state.choices[key]!;
                    void run(
                      () =>
                        edge.executeRestaurantAdministration({
                          kind: 'UPDATE_TABLE',
                          commandId: commandId(),
                          expectedVersion: selection.version,
                          reason,
                          tableId: x.id,
                          zoneId: selection.value,
                          name: x.name,
                          capacity: x.capacity,
                          active: x.active,
                          displayOrder: x.displayOrder,
                        }),
                      'Mesa movida.',
                      key,
                    );
                  }}
                >
                  Guardar zona de {x.name}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => state.discardChoice(`choice:table:${x.id}`)}
                >
                  Descartar cambio de zona
                </Button>
              </>
            )}
            <Button
              type="button"
              disabled={busy || !x.zoneId}
              onClick={async () => {
                const zoneId = x.zoneId;
                if (zoneId && (!x.active || (await confirmDeactivate(`la mesa ${x.name}`))))
                  void run(
                    () =>
                      edge.executeRestaurantAdministration({
                        kind: 'UPDATE_TABLE',
                        commandId: commandId(),
                        expectedVersion: x.version,
                        reason,
                        tableId: x.id,
                        zoneId,
                        name: x.name,
                        capacity: x.capacity,
                        active: !x.active,
                        displayOrder: x.displayOrder,
                      }),
                    x.active ? 'Mesa desactivada.' : 'Mesa activada.',
                  );
              }}
            >
              {x.active ? 'Desactivar' : 'Activar'}
            </Button>
          </li>
        ))}
      </ul>
      <form
        data-draft="table"
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            () =>
              edge.executeRestaurantAdministration({
                kind: 'CREATE_TABLE',
                commandId: commandId(),
                expectedVersion: 0,
                reason,
                zoneId: table.zoneId,
                name: table.name,
                capacity: table.capacity ? Number(table.capacity) : null,
                displayOrder: admin.tables.length * 10,
              }),
            'Mesa creada.',
            'table',
          );
        }}
      >
        <SelectField
          label="Zona de la mesa"
          value={table.zoneId}
          onChange={(e) => setTable({ ...table, zoneId: e.target.value })}
        >
          {admin.zones
            .filter((z) => z.active)
            .map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
        </SelectField>
        <Field label="Mesa" value={table.name} set={(v) => setTable({ ...table, name: v })} />
        <Field
          label="Capacidad"
          value={table.capacity}
          set={(v) => setTable({ ...table, capacity: v })}
        />
        <Button disabled={busy || !table.zoneId}>Crear mesa</Button>
        {!table.zoneId && (
          <PrerequisiteNotice
            state={prerequisite({
              key: 'zone',
              label: 'Zona',
              status: 'missing',
              guidance: getUserGuidance('ZONE_REQUIRED'),
              authority: { source: 'edge' },
            })}
            onAction={state.navigate}
          />
        )}{' '}
      </form>
    </section>
  );
}

function TaxSection({ state }: { state: Context }) {
  const pendingProduct=useRef<{key:string;commandId:string}|null>(null);
  const {
    edge,
    admin,
    tax,
    products,
    busy,
    section,
    ask,
    showLocalError,
    taxForm,
    setTaxForm,
    productForm,
    setProductForm,
    run,
    navigate,
    reason,
    confirmDeactivate,
  } = state;
  if (!admin || !tax) return null;
  return (
    <section>
      <h3>Impuestos</h3>
      {!tax.defaultTaxProfileId && (
        <PrerequisiteNotice
          state={prerequisite({
            key: 'default-tax',
            label: 'Impuesto predeterminado',
            status: 'missing',
            guidance: getUserGuidance('TAX_CONFIGURATION_REQUIRED'),
            authority: { source: 'edge' },
          })}
          onAction={navigate}
        />
      )}
      <ul>
        {tax.profiles.map((x) => (
          <li key={x.id}>
            {x.name} · {(x.rateBasisPoints / 100).toFixed(2)}% ·{' '}
            {x.calculationMode === 'TAX_INCLUDED' ? 'incluido' : 'agregado'} ·{' '}
            {x.active ? 'activo' : 'inactivo'}
            <Button
              disabled={busy || tax.defaultTaxProfileId === x.id || !x.active}
              onClick={() =>
                void run(
                  () =>
                    edge.executeTaxAdministration({
                      kind: 'SET_DEFAULT_TAX_PROFILE',
                      commandId: commandId(),
                      expectedVersion: tax.configurationVersion,
                      reason,
                      profileId: x.id,
                    }),
                  'Impuesto predeterminado guardado.',
                )
              }
            >
              Predeterminado
            </Button>
            <Button
              disabled={busy || !x.active}
              onClick={async () => {
                const text = await ask(
                  'Nuevo porcentaje (por ejemplo 16 u 8.25)',
                  String(x.rateBasisPoints / 100),
                  x.id,
                );
                if (text === null) return;
                const rate = parseMoneyInputToMinorUnits(text);
                if (rate === null) {
                  showLocalError('Introduce un porcentaje con hasta dos decimales.');
                  return;
                }
                void run(
                  () =>
                    edge.executeTaxAdministration({
                      kind: 'REVISE_TAX_PROFILE',
                      commandId: commandId(),
                      expectedVersion: x.version,
                      reason,
                      profileId: x.id,
                      name: x.name,
                      rateBasisPoints: rate,
                      calculationMode: x.calculationMode,
                    }),
                  'Porcentaje de impuesto actualizado para nuevas operaciones.',
                );
              }}
            >
              Cambiar porcentaje
            </Button>
            <Button
              disabled={busy || !x.active}
              onClick={() =>
                void run(
                  () =>
                    edge.executeTaxAdministration({
                      kind: 'REVISE_TAX_PROFILE',
                      commandId: commandId(),
                      expectedVersion: x.version,
                      reason,
                      profileId: x.id,
                      name: x.name,
                      rateBasisPoints: x.rateBasisPoints,
                      calculationMode:
                        x.calculationMode === 'TAX_INCLUDED' ? 'TAX_ADDED' : 'TAX_INCLUDED',
                    }),
                  'Modo de impuesto actualizado para nuevas operaciones.',
                )
              }
            >
              Cambiar modo
            </Button>
            <Button
              disabled={busy || !x.active}
              onClick={async () => {
                if (await confirmDeactivate(`el perfil fiscal ${x.name}`))
                  void run(
                    () =>
                      edge.executeTaxAdministration({
                        kind: 'DEACTIVATE_TAX_PROFILE',
                        commandId: commandId(),
                        expectedVersion: x.version,
                        reason,
                        profileId: x.id,
                      }),
                    'Perfil fiscal desactivado.',
                  );
              }}
            >
              Desactivar
            </Button>
          </li>
        ))}
      </ul>
      <form
        data-draft="tax"
        onSubmit={(e) => {
          e.preventDefault();
          const rate = parseMoneyInputToMinorUnits(taxForm.rate);
          if (rate === null) {
            showLocalError('Introduce un porcentaje válido, por ejemplo 16 o 8.25.');
            return;
          }
          void run(
            () =>
              edge.executeTaxAdministration({
                kind: 'CREATE_TAX_PROFILE',
                commandId: commandId(),
                expectedVersion: 0,
                reason,
                name: taxForm.name,
                rateBasisPoints: rate,
                calculationMode: taxForm.mode,
              }),
            'Perfil fiscal creado.',
            'tax',
          );
        }}
      >
        <Field
          label="Nombre del impuesto"
          value={taxForm.name}
          set={(v) => setTaxForm({ ...taxForm, name: v })}
        />
        <Field
          label="Porcentaje (%)"
          value={taxForm.rate}
          set={(v) => setTaxForm({ ...taxForm, rate: v })}
          inputMode="decimal"
        />
        <small>Por ejemplo: 16 equivale al 16 %. Usa 0 para un impuesto de tasa cero.</small>
        <SelectField
          label="Cómo se aplica"
          value={taxForm.mode}
          onChange={(e) => setTaxForm({ ...taxForm, mode: e.target.value as typeof taxForm.mode })}
        >
          <option value="TAX_INCLUDED">Incluido en el precio</option>
          <option value="TAX_ADDED">Se agrega al precio</option>
        </SelectField>
        <Button disabled={busy}>Crear perfil</Button>
      </form>
      <form
        data-draft="product"
        onSubmit={(e) => {
          e.preventDefault();
          const selected = tax.profiles.find((x) => x.id === productForm.taxProfileId),
            currency = admin.operational.currency,
            amount = parseMoneyInputToMinorUnits(productForm.amount);
          if (!selected || !currency || amount === null) return;
          const payload={name:productForm.name,description:'',taxProfile:{id:selected.id,version:selected.version},basePrice:{amount,currency}};
          const key=JSON.stringify(payload);
          if(pendingProduct.current?.key!==key)pendingProduct.current={key,commandId:commandId()};
          const attempt=pendingProduct.current;
          void run(
            async () => {
              const result=await edge.catalogCommand({commandId:attempt.commandId,kind:'CREATE_PRODUCT',expectedVersion:0,payload});
              if(pendingProduct.current===attempt)pendingProduct.current=null;
              return result;
            },
            'Producto creado con el impuesto seleccionado.',
            'product',
          );
        }}
      >
        <h4>Crear producto</h4>
        <Field
          label="Nombre del producto"
          value={productForm.name}
          set={(v) => setProductForm({ ...productForm, name: v })}
        />
        <Field
          label={`Precio (${admin.operational.currency ?? 'moneda pendiente'})`}
          value={productForm.amount}
          set={(v) => setProductForm({ ...productForm, amount: v })}
          inputMode="decimal"
        />
        <small>
          Escribe el importe, por ejemplo 100.00. El impuesto se incluye o se agrega según el perfil
          seleccionado.
        </small>
        <SelectField
          label="Perfil fiscal del producto"
          value={productForm.taxProfileId}
          onChange={(e) => setProductForm({ ...productForm, taxProfileId: e.target.value })}
        >
          <option value="">Seleccione perfil fiscal…</option>
          {tax.profiles
            .filter((x) => x.active)
            .map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
        </SelectField>
        <Button
          disabled={
            busy ||
            !admin.operational.currency ||
            !productForm.name.trim() ||
            !productForm.taxProfileId ||
            parseMoneyInputToMinorUnits(productForm.amount) === null
          }
        >
          Crear producto
        </Button>
        {!admin.operational.currency && (
          <PrerequisiteNotice
            state={prerequisite({
              key: 'currency',
              label: 'Moneda',
              status: 'missing',
              guidance: getUserGuidance('CURRENCY_REQUIRED'),
              authority: { source: 'edge' },
            })}
            onAction={state.navigate}
          />
        )}{' '}
        {!productForm.taxProfileId && (
          <small role="status">Selecciona un impuesto activo para crear el producto.</small>
        )}
      </form>
      <h4>Impuestos de los productos</h4>
      {tax.products.map((product) => (
        <div key={product.id}>
          <SelectField
            label={`Impuesto de ${product.name}`}
            value={state.choices[`choice:product:${product.id}`]?.value ?? product.taxProfileId}
            disabled={busy}
            onChange={(e) =>
              state.choose(
                `choice:product:${product.id}`,
                product.taxProfileId,
                product.version,
                e.target.value,
                tax.profiles.find(p=>p.id===e.target.value)?.version,
              )
            }
          >
            <option value="">Selecciona un impuesto</option>
            {tax.profiles
              .filter((p) => p.active)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </SelectField>
          {state.choices[`choice:product:${product.id}`] && (
            <>
              <Button
                type="button"
                disabled={busy || !state.choices[`choice:product:${product.id}`]?.value}
                onClick={() => {
                  const key = `choice:product:${product.id}`,
                    selection = state.choices[key]!;
                  void run(
                    () =>
                      edge.executeTaxAdministration({
                        kind: 'ASSIGN_PRODUCT_TAX_PROFILE',
                        commandId: state.assignmentCommandId(key,{productId:product.id,...selection,reason}),
                        expectedVersion: selection.version,
                        reason,
                        productId: product.id,
                        profileId: selection.value,
                        profileVersion: selection.referenceVersion,
                      }),
                    'Impuesto del producto actualizado.',
                    key,
                  );
                }}
              >
                Guardar impuesto de {product.name}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => state.discardChoice(`choice:product:${product.id}`)}
              >
                Descartar cambio de impuesto
              </Button>
            </>
          )}
        </div>
      ))}
    </section>
  );
}

function TipsSection({ state }: { state: Context }) {
  const {
    edge,
    admin,
    configuration,
    busy,
    section,
    run,
    reason,
    tipPolicy,
    effectiveTipPercentages,
  } = state;
  if (!admin || !configuration) return null;
  return (
    <section>
      <h3>Propinas</h3>
      {!tipPolicy?.ownerConfigurable && (
        <PrerequisiteNotice
          state={prerequisite({
            key: 'tips-delegation',
            label: 'Política de propinas',
            status: 'blocked',
            guidance: getUserGuidance('TIP_POLICY_NOT_DELEGATED'),
            authority: { source: 'signed-configuration' },
          })}
        />
      )}
      <p>
        Preferencia local: {admin.operational.tipPreferences ? 'configurada' : 'no configurada'}.
        Opciones efectivas:{' '}
        {effectiveTipPercentages.map((x) => `${x / 100}%`).join(', ') || 'sin porcentajes'}.
      </p>
      <Button
        disabled={busy || !tipPolicy?.ownerConfigurable}
        onClick={() =>
          void run(
            () =>
              edge.executeRestaurantAdministration({
                kind: 'SET_TIP_PREFERENCES',
                commandId: commandId(),
                expectedVersion: admin.operational.version,
                reason,
                preferences: {
                  enabled: true,
                  percentageOptionsBasisPoints: tipPolicy?.allowPercentages
                    ? tipPolicy.allowedPercentagesBasisPoints
                    : [],
                  fixedAmountEnabled: tipPolicy?.allowFixedAmount ?? false,
                },
              }),
            'Preferencias de propinas guardadas.',
          )
        }
      >
        Habilitar lo permitido
      </Button>
      <Button
        disabled={busy || !tipPolicy?.ownerConfigurable}
        onClick={() =>
          void run(
            () =>
              edge.executeRestaurantAdministration({
                kind: 'SET_TIP_PREFERENCES',
                commandId: commandId(),
                expectedVersion: admin.operational.version,
                reason,
                preferences: {
                  enabled: false,
                  percentageOptionsBasisPoints: [],
                  fixedAmountEnabled: false,
                },
              }),
            'Propinas locales deshabilitadas.',
          )
        }
      >
        Deshabilitar localmente
      </Button>
    </section>
  );
}

function PersonnelSection({ state }: { state: Context }) {
  const {
    edge,
    currentUserId,
    people,
    error,
    busy,
    ask,
    capturePin,
    person,
    setPerson,
    run,
    reason,
    confirmDeactivate,
    changeRoles,
  } = state;
  if (!people) return null;
  const canManage = state.permissions.includes('PERSONNEL_MANAGE');
  const canOwnPin = state.permissions.includes('OWN_PIN_CHANGE');
  return (
    <form
      data-draft="person"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (!validPersonnelPin(person.pin)) return;
        const id = commandId();
        void run(
          () =>
            edge.executePersonnel({
              kind: 'ENROLL',
              commandId: id,
              userId: commandId(),
              expectedVersion: 0,
              reason,
              displayName: person.displayName,
              newPin: person.pin,
              roles: [person.role],
            }),
          'Persona creada.',
          'person',
        );
      }}
    >
      <h3>Personal</h3>
      {!canManage && (
        <InlineAlert tone="info">
          Puedes consultar el personal. Administrar personas requiere el permiso correspondiente; tu
          propio PIN puede cambiarse si tienes autorización.
        </InlineAlert>
      )}
      {people.ownerRecoveryRequired && (
        <p className="error-banner">Se requiere recuperar el acceso del propietario.</p>
      )}
      <ul>
        {people.users.map((x) => (
          <li key={x.userId}>
            {x.displayName} · {x.roles.map(roleLabel).join(', ')} ·{' '}
            {x.status === 'ACTIVE' ? 'Activo' : 'Desactivado'}
            {x.restrictions.length ? (
              <TechnicalDetails>{x.restrictions.join(', ')}</TechnicalDetails>
            ) : null}
            <Button
              type="button"
              disabled={busy || !canManage}
              onClick={async () => {
                const displayName = await ask('Nombre visible', x.displayName, x.userId);
                if (displayName)
                  void run(
                    () =>
                      edge.executePersonnel({
                        kind: 'RENAME',
                        commandId: commandId(),
                        userId: x.userId,
                        expectedVersion: x.version,
                        reason,
                        displayName,
                      }),
                    'Persona renombrada; vuelva a iniciar sesión si corresponde.',
                  );
              }}
            >
              Renombrar
            </Button>
            <Button type="button" disabled={busy || !canManage} onClick={() => changeRoles(x)}>
              Roles
            </Button>
            <Button
              type="button"
              disabled={busy || !(canManage || (x.userId === currentUserId && canOwnPin))}
              onClick={async () => {
                capturePin(x.userId === currentUserId, ({ newPin, oldPin }) => {
                  void run(
                    () =>
                      edge.executePersonnel({
                        kind: 'ROTATE_CREDENTIAL',
                        commandId: commandId(),
                        userId: x.userId,
                        expectedVersion: x.version,
                        reason,
                        newPin,
                        ...(oldPin ? { oldPin } : {}),
                      }),
                    'PIN cambiado; las sesiones anteriores quedaron invalidadas.',
                  );
                });
              }}
            >
              Cambiar PIN
            </Button>
            <Button
              type="button"
              disabled={busy || !canManage}
              onClick={() =>
                void run(
                  () =>
                    edge.executePersonnel({
                      kind: 'INVALIDATE_SESSIONS',
                      commandId: commandId(),
                      userId: x.userId,
                      expectedVersion: x.version,
                      reason,
                    }),
                  'Sesiones invalidadas.',
                )
              }
            >
              Invalidar sesiones
            </Button>
            {x.restrictions.some((r) => r !== 'USER_DISABLED') && (
              <Button
                type="button"
                disabled={busy || !canManage}
                onClick={async () => {
                  capturePin(false, ({ newPin }) => {
                    const kind = x.restrictions.includes('USER_SECURITY_REPAIR_REQUIRED')
                      ? 'REPAIR'
                      : 'RESOLVE_RESTORED_USER';
                    void run(
                      () =>
                        edge.executePersonnel({
                          kind,
                          commandId: commandId(),
                          userId: x.userId,
                          expectedVersion: x.version,
                          reason,
                          newPin,
                          roles: x.roles as Array<
                            'OWNER' | 'MANAGER' | 'CASHIER' | 'WAITER' | 'KITCHEN'
                          >,
                          status: 'ACTIVE',
                        }),
                      'Persona revalidada por el propietario.',
                    );
                  });
                }}
              >
                Revalidar
              </Button>
            )}
            <Button
              type="button"
              disabled={busy || !canManage || x.roles.includes('OWNER')}
              onClick={async () => {
                if (x.status === 'ACTIVE') {
                  if (await confirmDeactivate(`a ${x.displayName}`))
                    void run(
                      () =>
                        edge.executePersonnel({
                          kind: 'DISABLE',
                          commandId: commandId(),
                          userId: x.userId,
                          expectedVersion: x.version,
                          reason,
                        }),
                      'Persona desactivada.',
                    );
                } else {
                  capturePin(false, ({ newPin }) => {
                    void run(
                      () =>
                        edge.executePersonnel({
                          kind: 'REENABLE',
                          commandId: commandId(),
                          userId: x.userId,
                          expectedVersion: x.version,
                          reason,
                          newPin,
                          roles: x.roles as Array<
                            'OWNER' | 'MANAGER' | 'CASHIER' | 'WAITER' | 'KITCHEN'
                          >,
                        }),
                      'Persona reactivada con credencial nueva.',
                    );
                  });
                }
              }}
            >
              {x.status === 'ACTIVE' ? 'Desactivar' : 'Reactivar'}
            </Button>
          </li>
        ))}
      </ul>
      <Field
        label="Nombre"
        value={person.displayName}
        set={(v) => setPerson({ ...person, displayName: v })}
      />
      <Field label="PIN nuevo" value={person.pin} set={(v) => setPerson({ ...person, pin: v })} />
      <SelectField
        label="Rol de la persona"
        value={person.role}
        onChange={(e) => setPerson({ ...person, role: e.target.value as typeof person.role })}
      >
        {['MANAGER', 'CASHIER', 'WAITER', 'KITCHEN'].map((r) => (
          <option key={r} value={r}>
            {roleLabel(r)}
          </option>
        ))}
      </SelectField>
      <Button disabled={busy || !canManage}>Crear persona</Button>
    </form>
  );
}
