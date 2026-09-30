import { useEffect, useRef, useState } from 'react';
import { EdgeClientError, type EdgeClient } from '@comanview/client-sdk';
import type {
  ProductModifierConfiguration as Config,
  CommercialModifierGroup as Group,
} from '@comanview/contracts';
import { Button, InlineAlert, getUserGuidance } from '@comanview/ui';
import { CatalogAttempt } from './catalogEditor.js';
import { decimalMinor, signedMinor, selectionRule, same } from './modifierEditor.js';
import './modifierAdministration.css';
type Assignment = { groupId: string; displayOrder: number; prices: Record<string, string> };
const draft = (c: Config): Assignment[] =>
  c.assignments.map((a) => ({
    groupId: a.groupId,
    displayOrder: a.displayOrder,
    prices: Object.fromEntries(
      Object.entries(a.overrides).map(([id, p]) => [id, decimalMinor(p.amount)]),
    ),
  }));
type Props = {
  edge: EdgeClient;
  productId: string;
  productVersion: number;
  disabled: boolean;
  canManage: boolean;
  refreshToken?: unknown;
  onDirty(value: boolean): void;
  onBusy(value: boolean): void;
  onSaved(): Promise<void>;
  confirm(message: string): Promise<boolean>;
};
export function ProductModifiersEditor(props: Props) {
  const [base, setBase] = useState<Config | null>(null),
    [current, setCurrent] = useState<Config | null>(null),
    [groups, setGroups] = useState<Group[]>([]),
    [rows, setRows] = useState<Assignment[]>([]),
    [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [pending, setPending] = useState<CatalogAttempt | null>(null),
    [reconcile, setReconcile] = useState(false);
  const latest = useRef(props);
  latest.current = props;
  const initialized = useRef(false),
    sequence = useRef(0);
  const dirty = !!base && !same(rows, draft(base));
  const stale =
    !!base &&
    !!current &&
    (current.version !== base.version ||
      base.groups.some((g) => groups.find((x) => x.id === g.id)?.version !== g.version));
  useEffect(() => {
    latest.current.onDirty(dirty || !!pending || reconcile);
  }, [dirty, pending, reconcile]);
  useEffect(() => {
    latest.current.onBusy(busy || !!pending || reconcile);
  }, [busy, pending, reconcile]);
  useEffect(
    () => () => {
      sequence.current++;
      latest.current.onDirty(false);
      latest.current.onBusy(false);
    },
    [],
  );
  async function load(reset = false) {
    const request = ++sequence.current;
    try {
      const [c, all] = await Promise.all([
        props.edge.getProductModifierConfiguration(props.productId),
        props.edge.getModifierAdministration(),
      ]);
      if (request !== sequence.current) return;
      setCurrent(c);
      setGroups(all.groups);
      if (reset || !initialized.current) {
        initialized.current = true;
        setBase(c);
        setRows(draft(c));
      }
    } catch (e) {
      setError(
        e instanceof EdgeClientError
          ? getUserGuidance(e).explanation
          : 'No se pudieron consultar las opciones.',
      );
      throw e;
    }
  }
  useEffect(() => {
    void load().catch(() => {});
  }, [props.productVersion, props.refreshToken]);
  const blocked = props.disabled || busy || !!pending || reconcile || stale || !props.canManage;
  async function save(attempt?: CatalogAttempt) {
    if (!base) return;
    try {
      if (!attempt) {
        const assignments = rows.map((a, displayOrder) => {
          const g = groups.find((g) => g.id === a.groupId);
          if (!g) throw new Error('El grupo ya no existe.');
          return {
            groupId: a.groupId,
            groupVersion: g.version,
            displayOrder,
            overrides: Object.fromEntries(
              Object.entries(a.prices)
                .filter(([, v]) => v.trim() !== '')
                .map(([id, v]) => [id, { amount: signedMinor(v), currency: base.currency }]),
            ),
          };
        });
        attempt = new CatalogAttempt({
          kind: 'SET_PRODUCT_MODIFIERS',
          commandId: crypto.randomUUID(),
          entityId: base.productId,
          expectedVersion: base.version,
          payload: { assignments },
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Revisa los importes.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await attempt.run(props.edge);
      setPending(null);
      setReconcile(true);
      setNotice('Opciones guardadas. Las ventas anteriores no cambian.');
      await load(true);
      await props.onSaved();
      setReconcile(false);
    } catch (e) {
      if (attempt.result) {
        setError('Guardado confirmado; falta actualizar la vista. No repitas el cambio.');
      } else {
        if (
          e instanceof EdgeClientError &&
          (e.status === null || e.status >= 500 || e.status === 408)
        )
          setPending(attempt);
        setError(
          e instanceof EdgeClientError
            ? getUserGuidance(e).explanation
            : 'No se pudo confirmar el cambio.',
        );
        if (
          e instanceof EdgeClientError &&
          ['CATALOG_VERSION_CONFLICT', 'CATALOG_REFERENCE_CHANGED'].includes(e.code)
        )
          void load().catch(() => {});
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Opciones y extras" className="modifier-admin">
      <h4>Opciones y extras</h4>
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
      {notice && <InlineAlert tone="success">{notice}</InlineAlert>}
      {!base ? (
        <p>Cargando opciones…</p>
      ) : (
        <>
          <p>
            Asigna grupos reutilizables. Un precio vacío hereda el precio del grupo; escribir el
            mismo precio también conserva la herencia.
          </p>
          {props.disabled && <p>Guarda o descarta primero los otros cambios del producto.</p>}
          {pending && (
            <Button type="button" disabled={busy} onClick={() => void save(pending)}>
              Reintentar opciones
            </Button>
          )}
          {reconcile && (
            <Button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await load(true);
                  await props.onSaved();
                  setReconcile(false);
                  setError('');
                } catch {
                } finally {
                  setBusy(false);
                }
              }}
            >
              Consultar opciones guardadas
            </Button>
          )}
          {stale && (
            <InlineAlert tone="warning">
              El producto o un grupo compartido cambió. Tu borrador se conserva.
              <Button
                type="button"
                disabled={busy || !!pending}
                onClick={() => void load().catch(() => {})}
              >
                Consultar opciones actuales
              </Button>
              <Button
                type="button"
                disabled={busy || !!pending}
                onClick={async () => {
                  if (
                    current &&
                    (await props.confirm(
                      '¿Usar las versiones consultadas conservando tu selección y precios editados?',
                    ))
                  )
                    setBase({
                      ...current,
                      groups: groups.filter((g) => rows.some((a) => a.groupId === g.id)),
                    });
                }}
              >
                Usar versiones consultadas
              </Button>
            </InlineAlert>
          )}
          <fieldset disabled={blocked}>
            <legend>Grupos asignados</legend>
            <label>
              Añadir grupo
              <select value={selected} onChange={(e) => setSelected(e.target.value)}>
                <option value="">Selecciona un grupo</option>
                {groups
                  .filter((g) => g.active && !rows.some((a) => a.groupId === g.id))
                  .map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name} · {selectionRule(g.minSelections, g.maxSelections)}
                    </option>
                  ))}
              </select>
            </label>
            <Button
              type="button"
              disabled={!selected}
              onClick={() => {
                if (!rows.some((a) => a.groupId === selected))
                  setRows([...rows, { groupId: selected, displayOrder: rows.length, prices: {} }]);
                setSelected('');
              }}
            >
              Asignar grupo
            </Button>
            <ol>
              {rows.map((a, index) => {
                const g = groups.find((g) => g.id === a.groupId);
                return (
                  <li key={a.groupId}>
                    <h5>{g?.name ?? 'Grupo no disponible'}</h5>
                    <p>
                      {g && selectionRule(g.minSelections, g.maxSelections)} ·{' '}
                      {g?.options.length ?? 0} opciones
                    </p>
                    <div className="modifier-actions">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={async () => {
                          if (
                            await props.confirm(
                              '¿Quitar solo la asignación de este producto? El grupo y los otros productos se conservan.',
                            )
                          )
                            setRows(rows.filter((x) => x.groupId !== a.groupId));
                        }}
                      >
                        Quitar {g?.name}
                      </Button>
                      {[-1, 1].map((d) => (
                        <Button
                          type="button"
                          key={d}
                          variant="ghost"
                          disabled={index + d < 0 || index + d >= rows.length}
                          onClick={() => {
                            const next = [...rows];
                            [next[index], next[index + d]] = [next[index + d]!, next[index]!];
                            setRows(next.map((r, displayOrder) => ({ ...r, displayOrder })));
                          }}
                        >
                          {d < 0 ? 'Subir' : 'Bajar'} {g?.name}
                        </Button>
                      ))}
                    </div>
                    {g?.options.map((o) => (
                      <label key={o.id}>
                        {o.name} · {o.active ? 'En catálogo' : 'Retirada'} ·{' '}
                        {o.available ? 'Disponible' : 'No disponible'} · Heredado:{' '}
                        {decimalMinor(o.unitPriceDelta.amount)} {base.currency}
                        <input
                          aria-label={`Precio de ${o.name} para este producto`}
                          inputMode="decimal"
                          placeholder="Heredar"
                          value={a.prices[o.id] ?? ''}
                          onChange={(e) =>
                            setRows(
                              rows.map((r) =>
                                r.groupId === a.groupId
                                  ? { ...r, prices: { ...r.prices, [o.id]: e.target.value } }
                                  : r,
                              ),
                            )
                          }
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() =>
                            setRows(
                              rows.map((r) =>
                                r.groupId === a.groupId
                                  ? {
                                      ...r,
                                      prices: Object.fromEntries(
                                        Object.entries(r.prices).filter(([id]) => id !== o.id),
                                      ),
                                    }
                                  : r,
                              ),
                            )
                          }
                        >
                          Heredar {o.name}
                        </Button>
                      </label>
                    ))}
                  </li>
                );
              })}
            </ol>
            <Button type="button" disabled={!dirty} onClick={() => void save()}>
              Guardar opciones y extras
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!dirty}
              onClick={async () => {
                if (await props.confirm('¿Descartar los cambios de opciones y extras?'))
                  setRows(draft(base));
              }}
            >
              Descartar cambios de opciones
            </Button>
          </fieldset>
        </>
      )}
    </section>
  );
}
