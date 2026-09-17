// @vitest-environment jsdom
import { afterEach,describe,expect,it,vi } from 'vitest';
import { cleanup,render,screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './Button.js';
import { Dialog } from './Dialog.js';
import { Field,Input } from './Field.js';
import { InlineAlert,PrerequisiteNotice } from './Feedback.js';
import { getUserGuidance } from './guidance.js';
import { prerequisite } from './prerequisites.js';

afterEach(cleanup);
describe('field and feedback foundations',()=>{
  it('associates visible label, helper and error with its control',()=>{
    render(<Field label="Moneda" helper="Selecciona una moneda" error="Campo requerido" required><Input/></Field>);
    const input=screen.getByLabelText(/Moneda/);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const described=input.getAttribute('aria-describedby')!;
    expect(described.split(' ')).toHaveLength(2);
    expect(screen.getByRole('alert').textContent).toBe('Campo requerido');
  });
  it('uses alert only for urgent feedback and status otherwise',()=>{
    const {rerender}=render(<InlineAlert tone="success">Guardado</InlineAlert>);
    expect(screen.getByRole('status')).toBeTruthy();
    rerender(<InlineAlert tone="critical">Recuperación requerida</InlineAlert>);
    expect(screen.getByRole('alert')).toBeTruthy();
  });
  it('explains a blocked action and emits its typed navigation target',async()=>{
    const navigate=vi.fn();
    const guidance=getUserGuidance('CURRENCY_REQUIRED');
    render(<PrerequisiteNotice state={prerequisite({key:'currency',label:'Moneda',status:'missing',guidance,authority:{source:'edge'}})} onAction={navigate}/>);
    await userEvent.click(screen.getByRole('button',{name:'Configurar moneda'}));
    expect(navigate).toHaveBeenCalledWith({surface:'administration',section:'day-currency'});
  });
  it('does not render complete or not-applicable prerequisites',()=>{
    const {container,rerender}=render(<PrerequisiteNotice state={{key:'x',label:'X',status:'complete'}}/>);
    expect(container.textContent).toBe('');
    rerender(<PrerequisiteNotice state={{key:'x',label:'X',status:'not-applicable'}}/>);
    expect(container.textContent).toBe('');
  });
  it('keeps permission denial distinct and offers no unauthorized local action',()=>{
    const guidance=getUserGuidance('PERMISSION_DENIED');
    render(<PrerequisiteNotice state={prerequisite({key:'access',label:'Acceso',status:'blocked',reasonCode:'PERMISSION_DENIED',guidance,authority:{source:'edge'}})} onAction={vi.fn()}/>);
    expect(screen.getByRole('alert').textContent).toContain('No tienes permiso');
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('announces when prerequisite evidence is stale',()=>{
    render(<PrerequisiteNotice state={prerequisite({key:'currency',label:'Moneda',status:'missing',guidance:getUserGuidance('CURRENCY_REQUIRED'),authority:{source:'edge',stale:true}})}/>);
    expect(screen.getByText(/estado puede haber cambiado/).textContent).toContain('Actualiza');
  });
  it('marks loading buttons busy and disabled',()=>{
    render(<Button loading>Guardar</Button>);const button=screen.getByRole('button',{name:'Guardar'});
    expect(button.getAttribute('aria-busy')).toBe('true');expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('dialog accessibility',()=>{
  it('wraps focus around closed details and disabled fieldsets',async()=>{
    render(<Dialog open title="Opciones"><button>Inicio</button><details><summary>Avanzado</summary><input aria-label="Oculto"/></details><fieldset disabled><button>Sin permiso</button></fieldset></Dialog>);
    const first=screen.getByRole('button',{name:'Inicio'});first.focus();
    await userEvent.tab({shift:true});expect(document.activeElement).toBe(screen.getByText('Avanzado'));
    await userEvent.tab();expect(document.activeElement).toBe(first);
  });
  it('traps focus and closes with Escape',async()=>{
    const close=vi.fn();const user=userEvent.setup();
    render(<><button>Anterior</button><Dialog open title="Confirmar" description="Revisa la acción" onClose={close}><button autoFocus>Primero</button><button>Último</button></Dialog></>);
    const previous=screen.getByRole('button',{name:'Anterior'});previous.focus();
    const first=await screen.findByRole('button',{name:'Primero'});await new Promise(resolve=>setTimeout(resolve,0));
    expect(document.activeElement).toBe(first);
    await user.tab({shift:true});expect(document.activeElement).toBe(screen.getByRole('button',{name:'Último'}));
    await user.keyboard('{Escape}');expect(close).toHaveBeenCalledOnce();
  });
  it('restores focus after unmount and blocks outside content',async()=>{
    const {rerender}=render(<button>Anterior</button>);
    const previous=screen.getByRole('button',{name:'Anterior'});previous.focus();
    rerender(<><button>Anterior</button><Dialog open title="Modal"><button>Dentro</button></Dialog></>);
    await new Promise(resolve=>setTimeout(resolve,0));
    expect([...document.body.children].some(node=>(node as HTMLElement).inert)).toBe(true);
    rerender(<button>Anterior</button>);
    expect(document.activeElement?.textContent).toBe('Anterior');
  });
});
