import type { HTMLAttributes, ReactNode } from 'react';
import type { GuidanceSeverity, UserGuidance } from './guidance.js';
import type { PrerequisiteState } from './prerequisites.js';
import type { TypedNavigationTarget } from './navigation.js';
import { Button } from './Button.js';

type AlertTone = 'info'|'success'|'warning'|'error'|'critical';
interface AlertProps extends HTMLAttributes<HTMLDivElement>{tone?:AlertTone;title?:string|undefined;children:ReactNode;urgent?:boolean}
export function InlineAlert({tone='info',title,children,urgent=false,className='',...props}:AlertProps){return <div className={`cv-alert cv-alert--${tone} ${className}`.trim()} role={urgent||tone==='critical'?'alert':'status'} {...props}>{title?<strong>{title}</strong>:null}<div>{children}</div></div>;}
export function Banner(props:AlertProps){return <InlineAlert {...props} className={`cv-banner ${props.className??''}`.trim()}/>;}

export function StatusBadge({tone='neutral',children}:{tone?:'neutral'|'success'|'warning'|'error'|'info';children:ReactNode}){return <span className={`cv-status cv-status--${tone}`}>{children}</span>;}
export function PrerequisiteNotice({state,onAction}:{state:PrerequisiteState;onAction?:((target:TypedNavigationTarget)=>void)|undefined}){
  if(state.status==='complete'||state.status==='not-applicable')return null;
  const guidance=state.guidance;
  const tone:GuidanceSeverity=guidance?.severity??(state.status==='blocked'?'error':'warning');
  const action=state.action??guidance?.action;
  return <InlineAlert tone={tone} title={guidance?.title??state.label} urgent={state.status==='blocked'}>
    <p>{guidance?.explanation??'Completa este requisito antes de continuar.'}</p>
    {state.authority?.stale?<small>El estado puede haber cambiado. Actualiza antes de continuar.</small>:null}
    {action&&onAction?<Button type="button" variant="secondary" onClick={()=>onAction(action.target)}>{action.label}</Button>:null}
  </InlineAlert>;
}
export function TechnicalDetails({summary='Detalles técnicos',children}:{summary?:string;children:ReactNode}){return <details className="cv-technical-details"><summary>{summary}</summary><div>{children}</div></details>;}
export function VisuallyHidden({children}:{children:ReactNode}){return <span className="cv-visually-hidden">{children}</span>;}

export function guidanceTone(guidance:UserGuidance):AlertTone{return guidance.severity;}
