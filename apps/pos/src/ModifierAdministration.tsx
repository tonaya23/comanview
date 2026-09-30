import { useEffect, useRef, useState } from 'react';
import { EdgeClientError, type EdgeClient } from '@comanview/client-sdk';
import {
  CommercialModifierGroupSchema,
  type CommercialModifierGroup as Group,
  type CommercialModifierOption as Option,
  type CatalogCommandInput,
} from '@comanview/contracts';
import { Button, InlineAlert, getUserGuidance } from '@comanview/ui';
import { CatalogAttempt } from './catalogEditor.js';
import {
  groupDraft,
  optionDraft,
  groupPayload,
  optionPayload,
  selectionRule,
  decimalMinor,
  rebase,
  same,
  type GroupDraft,
  type OptionDraft,
} from './modifierEditor.js';
import './modifierAdministration.css';

type Props = {
  edge: EdgeClient;
  permissions: readonly string[];
  visible: boolean;
  refreshToken?: unknown;
  onDirty(dirty: boolean): void;
  onBusy(busy: boolean): void;
  confirm(message: string): Promise<boolean>;
};
type Editor = { base: Group | null; draft: GroupDraft };
type OptionEditor = { base: Option | null; draft: OptionDraft };
function message(error: unknown): string {
  if (error instanceof EdgeClientError) {
    const codes: Partial<Record<string, string>> = {
      CATALOG_REFERENCE_CHANGED:
        'La configuración cambió. Consulta el estado actual y revisa tu borrador antes de volver a guardar.',
      MODIFIER_CONFIGURATION_UNSATISFIABLE:
        'La regla no puede cumplirse. Revisa mínimo/máximo y conserva una opción disponible para los productos que requieren este grupo.',
      MODIFIER_GROUP_IN_USE:
        'Este grupo está asignado a productos activos. Retira primero esas asignaciones antes de desactivarlo.',
      CURRENCY_REQUIRED: 'Configura primero la moneda del restaurante en Día y moneda.',
      MODIFIER_GROUP_NOT_FOUND: 'El grupo ya no está disponible. Tu borrador se conserva.',
      MODIFIER_OPTION_NOT_FOUND: 'La opción ya no está disponible. Tu borrador se conserva.',
    };
    return codes[error.code] ?? getUserGuidance(error.code).explanation;
  }
  return 'No se pudo completar la operación. Tu borrador se conserva; consulta el estado actual.';
}
export function ModifierAdministration(props: Props) {
  const canView = props.permissions.includes('CATALOG_VIEW'),
    canManage = props.permissions.includes('CATALOG_MANAGE');
  const [groups, setGroups] = useState<Group[]>([]),
    [currency, setCurrency] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [query, setQuery] = useState(''),
    [inactive, setInactive] = useState(false),
    [usage, setUsage] = useState<Group | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null),
    [option, setOption] = useState<OptionEditor | null>(null);
  const [pending, setPending] = useState<CatalogAttempt | null>(null);
  const latestProps = useRef(props);
  latestProps.current = props;
  const request = useRef(0),
    focus = useRef<HTMLElement | null>(null),
    heading = useRef<HTMLHeadingElement | null>(null);
  const focusLabel = useRef('');
  const groupDirty = !!editor && !same(editor.draft, groupDraft(editor.base));
  const optionDirty =
    !!option && !same(option.draft, optionDraft(option.base, editor?.base?.options.length ?? 0));
  const dirty = groupDirty || optionDirty || !!pending;
  const current = editor?.base ? groups.find((g) => g.id === editor.base!.id) : undefined;
  const stale = !!editor?.base && !!loaded && (!current || current.version !== editor.base.version);
  useEffect(() => {
    latestProps.current.onDirty(dirty);
  }, [dirty]);
  useEffect(() => {
    latestProps.current.onBusy(busy);
  }, [busy]);
  useEffect(
    () => () => {
      request.current++;
      latestProps.current.onDirty(false);
      latestProps.current.onBusy(false);
    },
    [],
  );
  async function load() {
    if (!canView) return;
    const sequence = ++request.current;
    try {
      const result = await props.edge.getModifierAdministration();
      if (sequence !== request.current) return;
      setGroups(result.groups);
      setCurrency(result.currency);
      setLoaded(true);
    } catch (e) {
      if (sequence === request.current) {
        setLoaded(true);
        setError(message(e));
      }
    }
  }
  useEffect(() => {
    if (props.visible) void load();
  }, [props.visible, props.refreshToken, canView]);
  useEffect(() => {
    if (editor) heading.current?.focus();
    else if (focusLabel.current) {
      const target = [
        ...document.querySelectorAll<HTMLButtonElement>('.modifier-admin button'),
      ].find((b) => b.textContent === focusLabel.current);
      target?.focus();
    }
  }, [editor?.base?.id, !!editor]);
  async function close() {
    if (pending || busy) return;
    if (
      dirty &&
      !(await props.confirm(
        'Se descartará el borrador de este grupo y sus opciones. ¿Volver a la lista?',
      ))
    )
      return;
    setEditor(null);
    setOption(null);
    setError('');
    queueMicrotask(() => focus.current?.focus());
  }
  function open(g: Group | null) {
    focus.current = document.activeElement as HTMLElement;
    focusLabel.current = focus.current?.textContent ?? '';
    setEditor({ base: g, draft: groupDraft(g) });
    setOption(null);
    setError('');
    setNotice('');
  }
  async function run(
    command: CatalogCommandInput,
    kind: 'group' | 'option' | 'action',
    attempt = new CatalogAttempt(command),
  ) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await attempt.run(props.edge),
        g = CommercialModifierGroupSchema.parse(result.entities[0]);
      request.current++;
      setGroups((all) =>
        [...all.filter((x) => x.id !== g.id), g].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setEditor((e) =>
        e && (!e.base || e.base.id === g.id)
          ? { base: g, draft: kind === 'group' ? groupDraft(g) : e.draft }
          : e,
      );
      if (kind === 'option') setOption(null);
      setPending(null);
      setNotice(
        result.changed
          ? 'Cambio guardado. Las ventas anteriores conservan su configuración.'
          : 'No había cambios que guardar.',
      );
    } catch (e) {
      if (
        e instanceof EdgeClientError &&
        (e.status === null || e.status >= 500 || e.status === 408)
      )
        setPending(attempt);
      else setPending(null);
      setError(message(e));
      if (e instanceof EdgeClientError && e.code === 'CATALOG_REFERENCE_CHANGED') void load();
    } finally {
      setBusy(false);
    }
  }
  const pendingKind = useRef<'group' | 'option' | 'action'>('action');
  function send(command: CatalogCommandInput, kind: 'group' | 'option' | 'action') {
    pendingKind.current = kind;
    void run(command, kind);
  }
  async function sensitive(g: Group, command: CatalogCommandInput) {
    if (
      g.products.length &&
      !(await props.confirm(
        `Este grupo se usa en ${g.products.length} productos. El cambio afectará futuras selecciones. ¿Continuar?`,
      ))
    )
      return;
    send(command, 'action');
  }
  const blocked = busy || !!pending || stale || !canManage;
  if (!canView)
    return (
      <InlineAlert tone="warning">No tienes permiso para consultar modificadores.</InlineAlert>
    );
  return (
    <section className="modifier-admin" aria-label="Modificadores" aria-busy={busy}>
      {error && (
        <InlineAlert tone="error" urgent>
          {error}
        </InlineAlert>
      )}
      {notice && <InlineAlert tone="success">{notice}</InlineAlert>}
      {pending && (
        <InlineAlert tone="warning" title="Confirmación pendiente">
          No envíes otro cambio. Reintenta la misma operación para consultar su resultado sin
          duplicarla.
          <Button
            disabled={busy}
            onClick={() => void run(pending.command, pendingKind.current, pending)}
          >
            Reintentar operación
          </Button>
        </InlineAlert>
      )}
      {!canManage && (
        <InlineAlert>Solo consulta. Tu rol no puede modificar el catálogo.</InlineAlert>
      )}
      {!editor ? (
        <>
          <div className="modifier-toolbar">
            <h2>Modificadores</h2>
            <Button disabled={!canManage || busy} onClick={() => open(null)}>
              Nuevo grupo
            </Button>
          </div>
          <p>Reutiliza grupos de opciones y extras entre productos.</p>
          <label>
            Buscar grupo
            <input value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <label className="modifier-check">
            <input
              type="checkbox"
              checked={inactive}
              onChange={(e) => setInactive(e.target.checked)}
            />
            Mostrar inactivos
          </label>
          <Button variant="secondary" onClick={() => void load()}>
            Actualizar lista
          </Button>
          {!loaded ? (
            <p role="status">Cargando modificadores…</p>
          ) : (
            <ul className="modifier-list">
              {groups
                .filter(
                  (g) =>
                    (inactive || g.active) &&
                    g.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
                )
                .map((g) => (
                  <li key={g.id}>
                    <div>
                      <h3>{g.name}</h3>
                      <p>
                        {selectionRule(g.minSelections, g.maxSelections)} ·{' '}
                        {g.active ? 'Activo' : 'Inactivo'}
                      </p>
                      <p>
                        {g.options.length} opciones · Se usa en {g.products.length} productos
                      </p>
                    </div>
                    <div className="modifier-actions">
                      <Button onClick={() => open(g)}>
                        {canManage ? 'Editar' : 'Consultar'} {g.name}
                      </Button>
                      <details>
                        <summary>Más acciones: {g.name}</summary>
                        <Button
                          disabled={!canManage || busy}
                          onClick={() =>
                            void sensitive(g, {
                              kind: 'SET_MODIFIER_GROUP_ACTIVE',
                              commandId: crypto.randomUUID(),
                              entityId: g.id,
                              expectedVersion: g.version,
                              payload: { active: !g.active },
                            })
                          }
                        >
                          {g.active ? 'Desactivar' : 'Reactivar'}
                        </Button>
                        <Button variant="secondary" onClick={() => setUsage(g)}>
                          Ver productos que lo usan
                        </Button>
                      </details>
                    </div>
                  </li>
                ))}
            </ul>
          )}
          {loaded &&
            !groups.some(
              (g) =>
                (inactive || g.active) &&
                g.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
            ) && <p>No hay grupos con estos filtros.</p>}
        </>
      ) : (
        <>
          <div className="modifier-toolbar">
            <h2 ref={heading} tabIndex={-1}>
              {editor.base ? `Editar ${editor.base.name}` : 'Nuevo grupo'}
            </h2>
            <Button variant="secondary" disabled={busy || !!pending} onClick={() => void close()}>
              Volver a modificadores
            </Button>
          </div>
          <p>
            Este grupo se usa en {editor.base?.products.length ?? 0} productos. Los cambios se
            comparten en futuras selecciones.
          </p>
          {editor.base && (
            <Button variant="ghost" onClick={() => setUsage(current ?? editor.base!)}>
              Ver productos
            </Button>
          )}
          {stale && (
            <InlineAlert tone="warning" title="El grupo cambió">
              Tu borrador se conserva. Consulta y revisa el estado actual antes de guardar.
              <Button disabled={busy || !!pending} onClick={() => void load()}>
                Consultar estado actual
              </Button>
              {current && (
                <>
                  <p>
                    Actual: {current.name} ·{' '}
                    {selectionRule(current.minSelections, current.maxSelections)}
                  </p>
                  <Button
                    disabled={busy || !!pending}
                    onClick={async () => {
                      if (
                        !(await props.confirm(
                          'Usar la versión consultada conserva tus campos editados y recoge los demás cambios actuales. ¿Continuar?',
                        ))
                      )
                        return;
                      setEditor({
                        base: current,
                        draft: rebase(groupDraft(editor.base), editor.draft, groupDraft(current)),
                      });
                      if (option?.base) {
                        const fresh = current.options.find((o) => o.id === option.base!.id);
                        if (fresh)
                          setOption({
                            base: fresh,
                            draft: rebase(
                              optionDraft(option.base),
                              option.draft,
                              optionDraft(fresh),
                            ),
                          });
                      }
                    }}
                  >
                    Usar base consultada
                  </Button>
                </>
              )}
            </InlineAlert>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              try {
                const payload = groupPayload(editor.draft);
                send(
                  editor.base
                    ? {
                        kind: 'UPDATE_MODIFIER_GROUP',
                        commandId: crypto.randomUUID(),
                        entityId: editor.base.id,
                        expectedVersion: editor.base.version,
                        payload,
                      }
                    : {
                        kind: 'CREATE_MODIFIER_GROUP',
                        commandId: crypto.randomUUID(),
                        expectedVersion: 0,
                        payload,
                      },
                  'group',
                );
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Revisa los campos.');
              }
            }}
          >
            <fieldset disabled={blocked}>
              <legend>Información y regla de selección</legend>
              <label>
                Nombre del grupo
                <input
                  required
                  maxLength={200}
                  value={editor.draft.name}
                  onChange={(e) =>
                    setEditor({ ...editor, draft: { ...editor.draft, name: e.target.value } })
                  }
                />
              </label>
              <div className="modifier-actions" aria-label="Reglas rápidas">
                {[
                  ['Opcional', '0', '3'],
                  ['Elegir uno', '1', '1'],
                  ['Elegir varias', '1', '3'],
                ].map(([label, min, max]) => (
                  <Button
                    key={label}
                    type="button"
                    variant="secondary"
                    onClick={() =>
                      setEditor({ ...editor, draft: { ...editor.draft, min: min!, max: max! } })
                    }
                  >
                    {label}
                  </Button>
                ))}
              </div>
              <div className="modifier-fields">
                <label>
                  Mínimo de selecciones
                  <input
                    inputMode="numeric"
                    pattern="[0-9]+"
                    required
                    value={editor.draft.min}
                    onChange={(e) =>
                      setEditor({ ...editor, draft: { ...editor.draft, min: e.target.value } })
                    }
                  />
                </label>
                <label>
                  Máximo de selecciones
                  <input
                    inputMode="numeric"
                    pattern="[0-9]+"
                    required
                    value={editor.draft.max}
                    onChange={(e) =>
                      setEditor({ ...editor, draft: { ...editor.draft, max: e.target.value } })
                    }
                  />
                </label>
              </div>
              <p>
                {selectionRule(Number(editor.draft.min), Number(editor.draft.max))}. Las unidades de
                cada opción cuentan para el límite.
              </p>
              {editor.draft.max.trim() !== '' && Number(editor.draft.max) === 0 && (
                <InlineAlert tone="warning">
                  Con máximo 0 no se puede seleccionar ninguna opción. Usa un máximo mayor que
                  cero para ofrecer extras; «Opcional» permite hasta 3 por defecto.
                </InlineAlert>
              )}
              <label className="modifier-check">
                <input
                  type="checkbox"
                  checked={editor.draft.active}
                  onChange={(e) =>
                    setEditor({ ...editor, draft: { ...editor.draft, active: e.target.checked } })
                  }
                />
                Grupo activo
              </label>
              <Button type="submit">Guardar grupo</Button>
            </fieldset>
          </form>
          <h3>Opciones</h3>
          {!editor.base ? (
            <p>Guarda el grupo para añadir sus opciones.</p>
          ) : (
            <>
              {groupDirty && (
                <InlineAlert>
                  Guarda la regla del grupo antes de modificar sus opciones.
                </InlineAlert>
              )}
              {!currency && (
                <InlineAlert tone="warning">
                  Configura la moneda del restaurante en Día y moneda para crear opciones.
                </InlineAlert>
              )}
              <Button
                disabled={blocked || groupDirty || !!option || !currency}
                onClick={() =>
                  setOption({ base: null, draft: optionDraft(null, editor.base!.options.length) })
                }
              >
                Nueva opción
              </Button>
              <ul className="modifier-list">
                {editor.base.options.map((o, index) => (
                  <li key={o.id}>
                    <div>
                      <h4>{o.name}</h4>
                      <p>
                        {o.unitPriceDelta.amount > 0 ? '+' : ''}
                        {decimalMinor(o.unitPriceDelta.amount)} {o.unitPriceDelta.currency} ·{' '}
                        {o.active ? 'En catálogo' : 'Retirada'} ·{' '}
                        {o.available ? 'Disponible' : 'No disponible'}
                      </p>
                    </div>
                    <div className="modifier-actions">
                      <Button
                        disabled={blocked || groupDirty || !!option}
                        onClick={() => setOption({ base: o, draft: optionDraft(o) })}
                      >
                        Editar {o.name}
                      </Button>
                      {(['active', 'available'] as const).map((field) => (
                        <Button
                          key={field}
                          variant="secondary"
                          disabled={blocked || groupDirty || !!option}
                          onClick={() =>
                            void sensitive(
                              editor.base!,
                              field === 'active'
                                ? {
                                    kind: 'SET_MODIFIER_OPTION_ACTIVE',
                                    commandId: crypto.randomUUID(),
                                    entityId: o.id,
                                    expectedVersion: o.version,
                                    group: { id: editor.base!.id, version: editor.base!.version },
                                    payload: { active: !o.active },
                                  }
                                : {
                                    kind: 'SET_MODIFIER_OPTION_AVAILABILITY',
                                    commandId: crypto.randomUUID(),
                                    entityId: o.id,
                                    expectedVersion: o.version,
                                    group: { id: editor.base!.id, version: editor.base!.version },
                                    payload: { available: !o.available },
                                  },
                            )
                          }
                        >
                          {field === 'active'
                            ? o.active
                              ? 'Retirar'
                              : 'Reactivar'
                            : o.available
                              ? 'Marcar no disponible'
                              : 'Marcar disponible'}{' '}
                          {o.name}
                        </Button>
                      ))}
                      {[-1, 1].map((direction) => (
                        <Button
                          key={direction}
                          variant="ghost"
                          disabled={
                            blocked ||
                            groupDirty ||
                            !!option ||
                            index + direction < 0 ||
                            index + direction >= editor.base!.options.length
                          }
                          onClick={() => {
                            const ordered = [...editor.base!.options];
                            [ordered[index], ordered[index + direction]] = [
                              ordered[index + direction]!,
                              ordered[index]!,
                            ];
                            send(
                              {
                                kind: 'REORDER_MODIFIER_OPTIONS',
                                commandId: crypto.randomUUID(),
                                entityId: editor.base!.id,
                                expectedVersion: editor.base!.version,
                                payload: {
                                  options: ordered.map((item, displayOrder) => ({
                                    id: item.id,
                                    expectedVersion: item.version,
                                    displayOrder,
                                  })),
                                },
                              },
                              'action',
                            );
                          }}
                        >
                          {direction < 0 ? 'Subir' : 'Bajar'} {o.name}
                        </Button>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
              {option && (
                <form
                  aria-label="Editor de opción"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!currency) return;
                    try {
                      const payload = optionPayload(option.draft, currency),
                        group = { id: editor.base!.id, version: editor.base!.version };
                      send(
                        option.base
                          ? {
                              kind: 'UPDATE_MODIFIER_OPTION',
                              commandId: crypto.randomUUID(),
                              entityId: option.base.id,
                              expectedVersion: option.base.version,
                              group,
                              payload,
                            }
                          : {
                              kind: 'CREATE_MODIFIER_OPTION',
                              commandId: crypto.randomUUID(),
                              expectedVersion: 0,
                              group,
                              payload,
                            },
                        'option',
                      );
                    } catch (e) {
                      setError(e instanceof Error ? e.message : 'Revisa los campos.');
                    }
                  }}
                >
                  <fieldset disabled={blocked || groupDirty}>
                    <legend>{option.base ? 'Editar opción' : 'Nueva opción'}</legend>
                    <label>
                      Nombre de la opción
                      <input
                        autoFocus
                        required
                        maxLength={200}
                        value={option.draft.name}
                        onChange={(e) =>
                          setOption({ ...option, draft: { ...option.draft, name: e.target.value } })
                        }
                      />
                    </label>
                    <label>
                      Ajuste de precio por unidad ({currency})
                      <input
                        inputMode="decimal"
                        required
                        value={option.draft.price}
                        onChange={(e) =>
                          setOption({
                            ...option,
                            draft: { ...option.draft, price: e.target.value },
                          })
                        }
                      />
                    </label>
                    <p>
                      Usa 15.00 para agregar, 0 para no cambiar el precio o -10.00 para descontar.
                    </p>
                    <label>
                      Posición
                      <input
                        inputMode="numeric"
                        pattern="[0-9]+"
                        required
                        value={option.draft.order}
                        onChange={(e) =>
                          setOption({
                            ...option,
                            draft: { ...option.draft, order: e.target.value },
                          })
                        }
                      />
                    </label>
                    <label className="modifier-check">
                      <input
                        type="checkbox"
                        checked={option.draft.active}
                        onChange={(e) =>
                          setOption({
                            ...option,
                            draft: { ...option.draft, active: e.target.checked },
                          })
                        }
                      />
                      En catálogo
                    </label>
                    <label className="modifier-check">
                      <input
                        type="checkbox"
                        checked={option.draft.available}
                        onChange={(e) =>
                          setOption({
                            ...option,
                            draft: { ...option.draft, available: e.target.checked },
                          })
                        }
                      />
                      Disponible para vender
                    </label>
                    <Button type="submit">Guardar opción</Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={async () => {
                        if (
                          !optionDirty ||
                          (await props.confirm('¿Descartar el borrador de esta opción?'))
                        )
                          setOption(null);
                      }}
                    >
                      Cancelar opción
                    </Button>
                  </fieldset>
                </form>
              )}
            </>
          )}
        </>
      )}
      {usage && (
        <aside aria-label="Productos que usan el grupo">
          <h3>Productos que usan {usage.name}</h3>
          <ul>
            {usage.products.map((p) => (
              <li key={p.id}>
                {p.name} · {p.active ? 'En catálogo' : 'Retirado'}
              </li>
            ))}
          </ul>
          {!usage.products.length && <p>Ningún producto utiliza este grupo todavía.</p>}
          <Button variant="secondary" onClick={() => setUsage(null)}>
            Cerrar productos
          </Button>
        </aside>
      )}
    </section>
  );
}
