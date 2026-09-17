import { useEffect, useState } from 'react';
import { InlineAlert } from '@comanview/ui';
export const kitchenViewportLimited = (width: number, height: number) =>
  width < 1024 || height < 640;
export function KitchenViewportNotice() {
  const [limited, setLimited] = useState(() =>
    kitchenViewportLimited(window.innerWidth, window.innerHeight),
  );
  useEffect(() => {
    const update = () => setLimited(kitchenViewportLimited(window.innerWidth, window.innerHeight));
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return limited ? (
    <InlineAlert tone="warning" title="Pantalla de cocina: vista limitada">
      Usa una pantalla de al menos 1024 × 640 px. En esta ventana pequeña, desplázate
      horizontalmente para consultar las tres columnas; no es una vista móvil.
    </InlineAlert>
  ) : null;
}
