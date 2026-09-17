import { cloneElement, forwardRef, useId, type InputHTMLAttributes, type ReactElement, type SelectHTMLAttributes } from 'react';

export interface FieldProps {
  label:string; helper?:string; error?:string; required?:boolean;
  children:ReactElement<Record<string,unknown>>;
}
export function Field({label,helper,error,required,children}:FieldProps){
  const generated=useId(),controlId=(children.props['id'] as string|undefined)??`${generated}-control`;
  const helperId=helper?`${generated}-helper`:undefined,errorId=error?`${generated}-error`:undefined;
  const described=[children.props['aria-describedby'],helperId,errorId].filter(Boolean).join(' ')||undefined;
  const control=cloneElement(children,{id:controlId,'aria-describedby':described,'aria-invalid':error?true:children.props['aria-invalid'],required:required??children.props['required']});
  return <div className={`cv-field${error?' cv-field--error':''}`}><label htmlFor={controlId}>{label}{required?<span aria-hidden="true"> *</span>:null}</label>{control}{helper?<small id={helperId}>{helper}</small>:null}{error?<small id={errorId} role="alert">{error}</small>:null}</div>;
}
export const Input=forwardRef<HTMLInputElement,InputHTMLAttributes<HTMLInputElement>>(function Input({className='',...props},ref){return <input ref={ref} className={`cv-input ${className}`.trim()} {...props}/>;});
export const Select=forwardRef<HTMLSelectElement,SelectHTMLAttributes<HTMLSelectElement>>(function Select({className='',...props},ref){return <select ref={ref} className={`cv-select ${className}`.trim()} {...props}/>;});
