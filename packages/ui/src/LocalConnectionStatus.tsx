import { useEffect, useState } from 'react';
import { InlineAlert } from './Feedback.js';

export type LocalConnection = 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED';
export function localConnectionPresentation(
  local: LocalConnection,
  realtime: boolean,
  networkHint: boolean,
) {
  if (local === 'DISCONNECTED')
    return {
      tone: 'error' as const,
      title: 'Sin conexión local',
      explanation:
        'Los datos pueden estar desactualizados. No des por confirmada una operación sin respuesta. Comprobaremos la conexión automáticamente.',
    };
  if (local === 'CONNECTING')
    return {
      tone: 'info' as const,
      title: 'Comprobando conexión local',
      explanation: 'Esperando la respuesta del servicio del restaurante.',
    };
  if (!realtime)
    return {
      tone: 'warning' as const,
      title: 'Reconectando avisos en vivo',
      explanation:
        'El servicio local responde. Consultamos los cambios periódicamente mientras se recuperan los avisos.',
    };
  return {
    tone: 'success' as const,
    title: networkHint ? 'Operación local disponible' : 'Operación local disponible · red limitada',
    explanation: networkHint
      ? 'Conectado al restaurante.'
      : 'El navegador indica falta de red externa; la conexión local sí responde.',
  };
}
export function LocalConnectionStatus({
  local,
  realtime,
}: {
  local: LocalConnection;
  realtime: boolean;
}) {
  const [networkHint, setNetworkHint] = useState(
    () => typeof navigator === 'undefined' || navigator.onLine,
  );
  useEffect(() => {
    const update = () => setNetworkHint(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  const state = localConnectionPresentation(local, realtime, networkHint);
  return (
    <InlineAlert className="local-connection-status" tone={state.tone} title={state.title}>
      {state.explanation}
    </InlineAlert>
  );
}
