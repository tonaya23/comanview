import type {
  CommercialModifierGroup as Group,
  CommercialModifierOption as Option,
} from '@comanview/contracts';
export type GroupDraft = { name: string; min: string; max: string; active: boolean };
export type OptionDraft = {
  name: string;
  price: string;
  active: boolean;
  available: boolean;
  order: string;
};
export const groupDraft = (g: Group | null): GroupDraft => ({
  name: g?.name ?? '',
  min: String(g?.minSelections ?? 0),
  max: String(g?.maxSelections ?? 3),
  active: g?.active ?? true,
});
export function decimalMinor(amount: number): string {
  const value = BigInt(amount),
    abs = value < 0n ? -value : value;
  return `${value < 0n ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}
export function signedMinor(input: string): number {
  const match = /^(-?)(\d+)(?:[.,](\d{1,2}))?$/.exec(input.trim());
  if (!match)
    throw new Error('Escribe un importe con hasta dos decimales, por ejemplo 15.00 o -10.00.');
  const value =
    (BigInt(match[2]!) * 100n + BigInt((match[3] ?? '').padEnd(2, '0'))) * (match[1] ? -1n : 1n);
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER))
    throw new Error('El importe es demasiado grande.');
  return Number(value);
}
export const optionDraft = (o: Option | null, order = 0): OptionDraft => ({
  name: o?.name ?? '',
  price: decimalMinor(o?.unitPriceDelta.amount ?? 0),
  active: o?.active ?? true,
  available: o?.available ?? true,
  order: String(o?.displayOrder ?? order),
});
export function selectionRule(min: number, max: number): string {
  if (min === 0 && max === 0) return 'Sin selecciones permitidas';
  return min === 1 && max === 1
    ? 'Obligatorio · Elegir 1'
    : min === 0
      ? `Opcional · Hasta ${max}`
      : `Obligatorio · De ${min} a ${max}`;
}
export function count(value: string): number {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw new Error('Usa cantidades enteras iguales o mayores que cero.');
  return Number(value);
}
export function groupPayload(d: GroupDraft) {
  const minSelections = count(d.min),
    maxSelections = count(d.max);
  if (minSelections > maxSelections)
    throw new Error('El máximo debe ser igual o mayor que el mínimo.');
  if (!d.name.trim()) throw new Error('Escribe el nombre del grupo.');
  return { name: d.name.trim(), minSelections, maxSelections, active: d.active };
}
export function optionPayload(d: OptionDraft, currency: string) {
  if (!d.name.trim()) throw new Error('Escribe el nombre de la opción.');
  return {
    name: d.name.trim(),
    unitPriceDelta: { amount: signedMinor(d.price), currency },
    active: d.active,
    available: d.available,
    displayOrder: count(d.order),
  };
}
export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** Preserve only fields edited locally when explicitly rebasing. */
export function rebase<T extends object>(base: T, draft: T, fresh: T): T {
  const result = { ...fresh };
  for (const key of Object.keys(draft) as (keyof T)[])
    if (!same(base[key], draft[key])) result[key] = draft[key];
  return result;
}
