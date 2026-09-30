// Development-only visual fixture. No network client, storage, identity or operational data.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ModifierAdministration } from '../src/ModifierAdministration.js';
import { AdministrationShell } from '../src/AdministrationShell.js';
import type { EdgeClient } from '@comanview/client-sdk';
import type { CommercialModifierGroup } from '@comanview/contracts';
import '../src/styles.css';
const groupId=crypto.randomUUID();
const group:CommercialModifierGroup={id:groupId,version:1,name:'Extras para hamburguesas',minSelections:0,maxSelections:3,active:true,products:[{id:crypto.randomUUID(),name:'Hamburguesa clásica',active:true}],options:['Extra queso','Extra tocino','Sin ingrediente'].map((name,displayOrder)=>({id:crypto.randomUUID(),groupId,version:1,name,displayOrder,active:true,available:displayOrder!==2,unitPriceDelta:{amount:[1500,2000,-1000][displayOrder]!,currency:'MXN'}}))};
const edge={getModifierAdministration:async()=>({currency:'MXN',groups:[group]}),catalogCommand:async()=>{throw new Error('Visual fixture is read-only');}} as unknown as EdgeClient;
createRoot(document.getElementById('root')!).render(<AdministrationShell section="modifiers" permissions={['CATALOG_VIEW','CATALOG_MANAGE','ADMINISTRATION_VIEW']} busy={false} dirtySections={[]} onClose={()=>{}} onNavigate={()=>{}}><ModifierAdministration edge={edge} permissions={['CATALOG_VIEW','CATALOG_MANAGE']} visible onDirty={()=>{}} onBusy={()=>{}} confirm={async()=>false}/></AdministrationShell>);
