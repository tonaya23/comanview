import { useEffect, useState, type FormEvent } from 'react';

export const validPersonnelPin = (value: string) => /^\d{4,12}$/.test(value);

export function PersonnelPinDialog({ requireCurrent, onSubmit, onCancel }: {
  requireCurrent: boolean;
  onSubmit(values: { newPin: string; oldPin?: string }): void;
  onCancel(): void;
}) {
  const [newPin, setNewPin] = useState('');
  const [oldPin, setOldPin] = useState('');
  useEffect(()=>{const previous=document.activeElement;return()=>{if(previous instanceof HTMLElement)previous.focus();};},[]);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!validPersonnelPin(newPin) || (requireCurrent && !validPersonnelPin(oldPin))) return;
    const values = { newPin, ...(requireCurrent ? { oldPin } : {}) };
    setNewPin(''); setOldPin('');
    onSubmit(values);
  }
  return <div className="modal-backdrop"><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="personnel-pin-title"
    onKeyDown={event=>{
      if(event.key==='Escape'){event.preventDefault();onCancel();}
      if(event.key==='Tab'){
        const elements=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('input,button:not(:disabled)'));
        const first=elements[0],last=elements[elements.length-1];
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
      }
    }}>
    <h2 id="personnel-pin-title">Actualizar PIN</h2>
    <p>Usa entre 4 y 12 dígitos. Las sesiones anteriores se invalidarán según la operación autorizada.</p>
    <form onSubmit={submit}>
      {requireCurrent && <label>PIN actual<input autoFocus type="password" inputMode="numeric" autoComplete="current-password" minLength={4} maxLength={12} pattern="[0-9]{4,12}" required value={oldPin} onChange={e=>setOldPin(e.target.value)} /></label>}
      <label>PIN nuevo<input autoFocus={!requireCurrent} type="password" inputMode="numeric" autoComplete="new-password" minLength={4} maxLength={12} pattern="[0-9]{4,12}" required value={newPin} onChange={e=>setNewPin(e.target.value)} /></label>
      <button type="button" onClick={()=>{setNewPin('');setOldPin('');onCancel();}}>Cancelar</button>
      <button type="submit" disabled={!validPersonnelPin(newPin)||(requireCurrent&&!validPersonnelPin(oldPin))}>Guardar PIN</button>
    </form>
  </section></div>;
}
