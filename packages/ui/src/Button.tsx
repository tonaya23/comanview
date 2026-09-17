import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
}
export const Button = forwardRef<HTMLButtonElement,ButtonProps>(function Button(
  {variant='primary',loading=false,disabled,children,className='',...props},ref,
){return <button ref={ref} className={`cv-button cv-button--${variant} ${className}`.trim()} disabled={disabled||loading} aria-busy={loading||undefined} {...props}>{loading?<span className="cv-button__loading" aria-hidden="true"/>:null}{children}</button>;});

export interface IconButtonProps extends Omit<ButtonProps,'children'|'aria-label'> { 'aria-label': string; children: ReactNode }
export const IconButton=forwardRef<HTMLButtonElement,IconButtonProps>(function IconButton({className='',...props},ref){return <Button ref={ref} className={`cv-icon-button ${className}`.trim()} {...props}/>;});
