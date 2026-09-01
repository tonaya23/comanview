export type CashMovementType = 'CASH_IN' | 'CASH_OUT';

export function CashMovementTypeSelector(props:{
  value:CashMovementType;
  onChange(value:CashMovementType):void;
}) {
  return <div className="cash-movement-selector" role="radiogroup" aria-label="Tipo de movimiento de efectivo">
    <Option type="CASH_IN" title="Entrada" description="Dinero que entra físicamente a caja." {...props}/>
    <Option type="CASH_OUT" title="Salida" description="Dinero que sale físicamente de caja." {...props}/>
  </div>;
}

function Option(props:{
  type:CashMovementType;
  title:string;
  description:string;
  value:CashMovementType;
  onChange(value:CashMovementType):void;
}) {
  const selected=props.value===props.type;
  return <button type="button" role="radio" aria-checked={selected} data-movement-type={props.type} className={selected?'selected':''}
    onClick={()=>props.onChange(props.type)}>
    <span className="cash-movement-check" aria-hidden="true">{selected?'✓':'○'}</span>
    <span><strong>{props.title}</strong><small>{props.description}</small></span>
  </button>;
}
