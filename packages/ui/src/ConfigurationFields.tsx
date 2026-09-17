import { Field, Input, Select } from './Field.js';

const supported = (key: 'timeZone' | 'currency'): string[] => {
  const api = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  return api.supportedValuesOf?.(key) ?? (key === 'timeZone'
    ? ['America/Matamoros', 'America/Mexico_City', 'America/Tijuana', 'UTC']
    : ['MXN', 'USD', 'EUR']);
};
const timeZones = supported('timeZone');
const currencies = supported('currency');
const currencyNames = new Intl.DisplayNames(['es'], { type: 'currency' });
const zoneLabel = (zone: string) => zone === 'UTC' ? 'Tiempo universal (UTC)' : zone.replaceAll('_', ' ').split('/').reverse().join(' · ');

export function TimeZoneField({value,onChange}:{value:string;onChange(value:string):void}){
  const options=[...new Set([value,...timeZones].filter(Boolean))].sort((a,b)=>zoneLabel(a).localeCompare(zoneLabel(b),'es'));
  return <Field label="Zona horaria del restaurante" helper="Elige la ciudad de tu restaurante o una que comparta su zona horaria. Se aplica el horario de verano de esa región.">
    <Select value={value} onChange={e=>onChange(e.target.value)}>
      <option value="" disabled>Selecciona una ciudad o región</option>
      {options.map(zone=><option key={zone} value={zone}>{zoneLabel(zone)}</option>)}
    </Select>
  </Field>;
}

export function CurrencyField({value,onChange,disabled=false}:{value:string;onChange(value:string):void;disabled?:boolean}){
  const options=[...new Set([value,...currencies].filter(Boolean))];
  return <Field label="Moneda del restaurante" helper={disabled?'La moneda está bloqueada porque ya existe actividad financiera.':'Selecciona antes de registrar ventas. Cambiarla no convierte importes existentes.'}><Select value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}>
    <option value="" disabled>Selecciona una moneda</option>
    {options.map(code=><option key={code} value={code}>{currencyNames.of(code)??code} ({code})</option>)}
  </Select></Field>;
}

export function BusinessCutoffField({value,onChange}:{value:string;onChange(value:string):void}){
  return <Field label="Hora de inicio del día de negocio" required helper="Las operaciones anteriores a esta hora pertenecen al día de negocio anterior. Por ejemplo, con las 04:00, una venta a las 02:00 sigue en el día anterior. No es la hora de cierre del local."><Input type="time" step={60} value={value} onChange={e=>onChange(e.target.value)}/></Field>;
}
