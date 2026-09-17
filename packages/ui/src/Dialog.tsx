import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button.js';

const focusable =
  'summary,button:not(:disabled),[href],input:not(:disabled):not([type="hidden"]),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])';
function tabStops(panel: HTMLElement | null): HTMLElement[] {
  if (!panel) return [];
  return [...panel.querySelectorAll<HTMLElement>(focusable)].filter((element) => {
    if (element.matches(':disabled')) return false;
    for (
      let node: HTMLElement | null = element;
      node && node !== panel;
      node = node.parentElement
    ) {
      if (
        node.hidden ||
        node.inert ||
        getComputedStyle(node).display === 'none' ||
        getComputedStyle(node).visibility === 'hidden'
      )
        return false;
      if (
        node.tagName === 'DETAILS' &&
        !node.hasAttribute('open') &&
        !node.querySelector(':scope > summary')?.contains(element)
      )
        return false;
    }
    return true;
  });
}
export interface DialogProps {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  cancelable?: boolean;
  className?: string;
  onClose?(): void;
}
export function Dialog({
  open,
  title,
  description,
  children,
  cancelable = true,
  className = '',
  onClose,
}: DialogProps) {
  const titleId = useId(),
    descriptionId = useId(),
    panelRef = useRef<HTMLElement>(null),
    restoreRef = useRef<HTMLElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  if (typeof document !== 'undefined' && !hostRef.current) {
    hostRef.current = document.createElement('div');
    hostRef.current.dataset['cvDialogHost'] = 'true';
  }
  useEffect(() => {
    if (!open || !hostRef.current) return;
    const host = hostRef.current;
    document.body.append(host);
    restoreRef.current = document.activeElement as HTMLElement | null;
    const outside = [...document.body.children].filter((node) => node !== host) as HTMLElement[];
    const prior = outside.map((node) => ({ node, inert: node.inert }));
    outside.forEach((node) => {
      node.inert = true;
    });
    const timer = window.setTimeout(() => {
      const items = tabStops(panelRef.current);
      (
        items.find((item) => item.hasAttribute('autofocus')) ??
        items[0] ??
        panelRef.current
      )?.focus();
    });
    return () => {
      window.clearTimeout(timer);
      prior.forEach(({ node, inert }) => {
        node.inert = inert;
      });
      host.remove();
      restoreRef.current?.focus();
    };
  }, [open]);
  if (!open || !hostRef.current) return null;
  const keyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape' || event.key === 'Tab') event.stopPropagation();
    if (event.key === 'Escape' && cancelable && onClose) {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !panelRef.current) return;
    const items = tabStops(panelRef.current);
    if (!items.length) {
      event.preventDefault();
      panelRef.current.focus();
      return;
    }
    const first = items[0]!,
      last = items.at(-1)!;
    if (!items.includes(document.activeElement as HTMLElement)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  return createPortal(
    <div
      className="cv-dialog-backdrop"
      onMouseDown={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget && cancelable) onClose?.();
      }}
    >
      <section
        ref={panelRef}
        className={`cv-dialog ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onKeyDown={keyDown}
      >
        <h2 id={titleId}>{title}</h2>
        {description ? <p id={descriptionId}>{description}</p> : null}
        {children}
      </section>
    </div>,
    hostRef.current,
  );
}
export function ConfirmationDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  destructive = false,
  loading = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm(): void;
  onClose(): void;
}) {
  return (
    <Dialog
      open={open}
      title={title}
      description={description}
      cancelable={!loading}
      onClose={onClose}
    >
      <div className="cv-dialog__actions">
        <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>
          {cancelLabel}
        </Button>
        <Button
          type="button"
          variant={destructive ? 'danger' : 'primary'}
          loading={loading}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
