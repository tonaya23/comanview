import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createEdgeClient } from '@comanview/client-sdk';
import {
  KdsRealtimeMessageSchema,
  type KdsPreparationStatus,
  type KdsStationResponse,
  type KdsTicketResponse,
} from '@comanview/contracts';
import {
  formatElapsed,
  getKdsErrorMessage,
  reconnectDelayMs,
  shouldRefreshForMessage,
  timerTone,
} from './kdsLogic.js';

const edge = createEdgeClient({ baseUrl: '/api' });
const columns: Array<{ status: KdsPreparationStatus; title: string }> = [
  { status: 'PENDING', title: 'PENDIENTES' },
  { status: 'PREPARING', title: 'PREPARANDO' },
  { status: 'READY', title: 'LISTOS' },
];

export function App() {
  const [stations, setStations] = useState<KdsStationResponse[]>([]);
  const [stationId, setStationId] = useState('');
  const [tickets, setTickets] = useState<KdsTicketResponse[]>([]);
  const [connection, setConnection] = useState<'CONNECTING' | 'CONNECTED' | 'DISCONNECTED'>(
    'CONNECTING',
  );
  const [pendingTicket, setPendingTicket] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const stationRef = useRef(stationId);
  stationRef.current = stationId;

  const refreshStations = useCallback(async () => {
    const next = await edge.getKdsStations();
    setStations(next);
    setStationId((current) => {
      if (current && next.some((station) => station.stationId === current)) return current;
      const fromUrl = new URLSearchParams(window.location.search).get('stationId');
      const stored = window.localStorage.getItem('comanview-kds-station');
      return (
        next.find((station) => station.stationId === fromUrl)?.stationId ??
        next.find((station) => station.stationId === stored)?.stationId ??
        next[0]?.stationId ??
        ''
      );
    });
  }, []);

  const refreshTickets = useCallback(async (selectedStation = stationRef.current) => {
    if (!selectedStation) return;
    try {
      const next = await edge.getKdsTickets(selectedStation);
      setTickets(next);
      setConnection('CONNECTED');
      setError(null);
    } catch (problem) {
      setConnection('DISCONNECTED');
      setError(getKdsErrorMessage(problem));
    }
  }, []);

  useEffect(() => {
    void refreshStations().catch((problem) => {
      setConnection('DISCONNECTED');
      setError(getKdsErrorMessage(problem));
    });
  }, [refreshStations]);

  useEffect(() => {
    if (!stationId) return;
    window.localStorage.setItem('comanview-kds-station', stationId);
    void refreshTickets(stationId);
  }, [stationId, refreshTickets]);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 1_000);
    const fallback = window.setInterval(() => {
      if (stationRef.current) {
        void refreshTickets();
      } else {
        void refreshStations().catch((problem) => {
          setConnection('DISCONNECTED');
          setError(getKdsErrorMessage(problem));
        });
      }
    }, 5_000);
    return () => {
      window.clearInterval(clock);
      window.clearInterval(fallback);
    };
  }, [refreshStations, refreshTickets]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let stopped = false;
    let attempt = 0;
    const connect = () => {
      if (stopped) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(`${protocol}//${window.location.host}/api/realtime`);
      socket.onopen = () => {
        attempt = 0;
        setConnection('CONNECTED');
        void refreshStations()
          .then(() => refreshTickets())
          .catch((problem) => {
            setConnection('DISCONNECTED');
            setError(getKdsErrorMessage(problem));
          });
      };
      socket.onmessage = (event) => {
        try {
          const parsed = KdsRealtimeMessageSchema.safeParse(JSON.parse(String(event.data)));
          if (parsed.success && shouldRefreshForMessage(parsed.data, stationRef.current)) {
            void refreshTickets();
          }
        } catch {
          // Realtime is a notification channel; invalid payloads are ignored and fallback refetch remains active.
        }
      };
      socket.onerror = () => socket?.close();
      socket.onclose = () => {
        if (stopped) return;
        setConnection('DISCONNECTED');
        reconnectTimer = window.setTimeout(connect, reconnectDelayMs(attempt++));
      };
    };
    connect();
    return () => {
      stopped = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [refreshStations, refreshTickets]);

  async function transition(ticket: KdsTicketResponse, target: 'PREPARING' | 'READY') {
    setPendingTicket(ticket.ticketId);
    setError(null);
    try {
      const request = { commandId: crypto.randomUUID() };
      if (target === 'PREPARING') {
        await edge.startKdsTicket(ticket.roundId, ticket.stationId, request);
      } else {
        await edge.markKdsTicketReady(ticket.roundId, ticket.stationId, request);
      }
      await refreshTickets(ticket.stationId);
    } catch (problem) {
      setError(getKdsErrorMessage(problem));
      await refreshTickets(ticket.stationId);
    } finally {
      setPendingTicket(null);
    }
  }

  const byStatus = useMemo(
    () =>
      Object.fromEntries(
        columns.map(({ status }) => [status, tickets.filter((ticket) => ticket.status === status)]),
      ) as Record<KdsPreparationStatus, KdsTicketResponse[]>,
    [tickets],
  );
  const selectedStation = stations.find((station) => station.stationId === stationId);

  return (
    <div className="kds-shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">COMANVIEW KDS</span>
          <h1>{selectedStation?.name ?? 'Selecciona estación'}</h1>
        </div>
        <nav className="stations" aria-label="Estaciones">
          {stations.map((station) => (
            <button
              key={station.stationId}
              className={station.stationId === stationId ? 'active' : ''}
              onClick={() => setStationId(station.stationId)}
            >
              {station.name}
            </button>
          ))}
        </nav>
        <div className={`connection ${connection.toLowerCase()}`}>
          <span /> {connection === 'CONNECTED' ? 'EDGE LOCAL' : 'CONEXIÓN LOCAL PERDIDA'}
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}
      <main className="board">
        {columns.map((column) => (
          <section key={column.status} className={`column ${column.status.toLowerCase()}`}>
            <header>
              <h2>{column.title}</h2>
              <strong>{byStatus[column.status].length}</strong>
            </header>
            <div className="ticket-list">
              {byStatus[column.status].map((ticket) => (
                <article
                  key={ticket.ticketId}
                  className={`ticket timer-${timerTone(
                    ticket.sentAt,
                    ticket.status,
                    ticket.readyAt,
                    now,
                  ).toLowerCase()}`}
                >
                  <div className="ticket-heading">
                    <div>
                      <strong>Orden {ticket.orderNumber}</strong>
                      <span>Ronda {ticket.roundNumber}</span>
                    </div>
                    <time>
                      {ticket.status === 'READY' ? 'Listo en ' : ''}
                      {formatElapsed(ticket.sentAt, ticket.status, ticket.readyAt, now)}
                    </time>
                  </div>
                  <div className="items">
                    {ticket.items.map((item) => (
                      <div key={item.orderItemId} className="item">
                        <h3>
                          <b>{item.quantity}×</b> {item.productName}
                        </h3>
                        {item.modifiers.map((modifier) => (
                          <div key={modifier.modifierOptionId} className="modifier">
                            + {modifier.name}
                          </div>
                        ))}
                        {item.specialInstructions && (
                          <div className="instructions">
                            <span>NOTA</span>
                            {item.specialInstructions}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {ticket.status === 'PENDING' && (
                    <button
                      className="action start"
                      disabled={pendingTicket === ticket.ticketId || connection !== 'CONNECTED'}
                      onClick={() => void transition(ticket, 'PREPARING')}
                    >
                      {pendingTicket === ticket.ticketId ? 'CONFIRMANDO…' : 'COMENZAR'}
                    </button>
                  )}
                  {ticket.status === 'PREPARING' && (
                    <button
                      className="action ready"
                      disabled={pendingTicket === ticket.ticketId || connection !== 'CONNECTED'}
                      onClick={() => void transition(ticket, 'READY')}
                    >
                      {pendingTicket === ticket.ticketId ? 'CONFIRMANDO…' : 'LISTO'}
                    </button>
                  )}
                </article>
              ))}
              {byStatus[column.status].length === 0 && <div className="empty">Sin tickets</div>}
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}
