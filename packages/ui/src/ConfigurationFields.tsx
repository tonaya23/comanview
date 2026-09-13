import { useId } from 'react';

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
  const id=useId();
  const options=[...new Set([value,...timeZones].filter(Boolean))].sort((a,b)=>zoneLabel(a).localeCompare(zoneLabel(b),'es'));
  return <label>Zona horaria del restaurante
    <select value={value} onChange={e=>onChange(e.target.value)} aria-describedby={id}>
      <option value="" disabled>Selecciona una ciudad o región</option>
      {options.map(zone=><option key={zone} value={zone}>{zoneLabel(zone)}</option>)}
    </select><small id={id}>Elige la ciudad de tu restaurante o una que comparta su zona horaria. Se aplica el horario de verano de esa región.</small>
  </label>;
}

export function CurrencyField({value,onChange,disabled=false}:{value:string;onChange(value:string):void;disabled?:boolean}){
  const id=useId(),options=[...new Set([value,...currencies].filter(Boolean))];
  return <label>Moneda del restaurante<select value={value} disabled={disabled} onChange={e=>onChange(e.target.value)} aria-describedby={id}>
    <option value="" disabled>Selecciona una moneda</option>
    {options.map(code=><option key={code} value={code}>{currencyNames.of(code)??code} ({code})</option>)}
  </select><small id={id}>{disabled?'La moneda está bloqueada porque ya existe actividad financiera.':'Selecciona antes de registrar ventas. Cambiarla no convierte importes existentes.'}</small></label>;
}

export function BusinessCutoffField({value,onChange}:{value:string;onChange(value:string):void}){
  const id=useId();
  return <label>Hora de inicio del día de negocio<input type="time" step={60} required value={value} onChange={e=>onChange(e.target.value)} aria-describedby={id}/>
    <small id={id}>Las operaciones anteriores a esta hora pertenecen al día de negocio anterior. Por ejemplo, con las 04:00, una venta a las 02:00 sigue en el día anterior. No es la hora de cierre del local.</small></label>;
}
