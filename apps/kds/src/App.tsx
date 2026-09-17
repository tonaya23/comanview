import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  createEdgeClient,
  EdgeClientError,
  invalidatesLocalSession,
  clearDevicePairing,
  createClientDevicePairing,
  createDeviceIdentity,
  getDeviceOnboardingState,
  loadDeviceIdentity,
  loadDevicePairing,
  markDeviceAuthorizationStatus,
  requestPairingWithIdentityRotation,
  saveDeviceIdentity,
  saveDevicePairing,
  type ClientDeviceIdentity,
  type ClientDevicePairing,
} from '@comanview/client-sdk';
import { InlineAlert, LocalConnectionStatus, DeviceOnboardingCard } from '@comanview/ui';
import {
  KdsRealtimeMessageSchema,
  PermissionCodes,
  type AuthUserResponse,
  type KdsPreparationStatus,
  type KdsStationResponse,
  type KdsTicketResponse,
} from '@comanview/contracts';
import { getKdsErrorMessage, reconnectDelayMs, shouldRefreshForMessage } from './kdsLogic.js';

import { KitchenTicket, kitchenActionReason, nextKitchenAction } from './KitchenTicket.js';
import { KitchenViewportNotice } from './KitchenViewportNotice.js';

const sessionTokenStorageKey = 'comanview.kds.sessionToken';
const edge = createEdgeClient({
  baseUrl: '/api',
  getAccessToken: () => window.localStorage.getItem(sessionTokenStorageKey),
});
const columns: Array<{ status: KdsPreparationStatus; title: string }> = [
  { status: 'PENDING', title: 'PENDIENTES' },
  { status: 'PREPARING', title: 'PREPARANDO' },
  { status: 'READY', title: 'LISTOS' },
];

export function App() {
  const [authUser, setAuthUser] = useState<AuthUserResponse | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [pin, setPin] = useState('');
  const [loginPending, setLoginPending] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [deviceIdentity, setDeviceIdentity] = useState<ClientDeviceIdentity | null>(null);
  const [pairing, setPairing] = useState<ClientDevicePairing | null>(null);
  const [pairingDisplayName, setPairingDisplayName] = useState('KDS');
  const [pairingPending, setPairingPending] = useState(false);
  const [stations, setStations] = useState<KdsStationResponse[]>([]);
  const [stationId, setStationId] = useState('');
  const [tickets, setTickets] = useState<KdsTicketResponse[]>([]);
  const [connection, setConnection] = useState<'CONNECTING' | 'CONNECTED' | 'DISCONNECTED'>(
    'CONNECTING',
  );
  const [realtime, setRealtime] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [stationsLoaded, setStationsLoaded] = useState(false);
  const ticketRequest = useRef(0);
  const transitionFocus = useRef<string | null>(null);
  const [pendingTicket, setPendingTicket] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const stationRef = useRef(stationId);
  stationRef.current = stationId;
  useEffect(() => {
    if (pendingTicket || !transitionFocus.current) return;
    const ticket = [...document.querySelectorAll<HTMLElement>('[data-ticket-id]')].find(
      (element) => element.dataset['ticketId'] === transitionFocus.current,
    );
    if (ticket) (ticket.querySelector<HTMLElement>('button:not(:disabled)') ?? ticket).focus();
    transitionFocus.current = null;
  }, [tickets, pendingTicket]);

  const clearLocalSession = useCallback(() => {
    window.localStorage.removeItem(sessionTokenStorageKey);
    setAuthUser(null);
    setStations([]);
    setTickets([]);
    stationRef.current = '';
    setStationId('');
    setReadError(null);
    setError(null);
    setStationsLoaded(false);
  }, []);
  useEffect(() => {
    void loadDeviceIdentity().then(async (v) => {
      const identity = v ?? createDeviceIdentity('KDS', 'KDS');
      if (!v) await saveDeviceIdentity(identity);
      setDeviceIdentity(identity);
      setPairingDisplayName(identity.displayName);
    });
  }, []);
  useEffect(() => {
    void loadDevicePairing().then((value) => {
      if (value) setPairing(value);
    });
  }, []);
  useEffect(() => {
    if (!authUser || !deviceIdentity || deviceIdentity.authorizationStatus === 'ACTIVE') return;
    void markDeviceAuthorizationStatus(deviceIdentity.deviceId, 'ACTIVE').then((active) => {
      if (active) setDeviceIdentity(active);
    });
  }, [authUser, deviceIdentity]);
  useEffect(() => {
    if (!pairing?.requestToken || !deviceIdentity) return;
    const poll = () =>
      void edge
        .getPairingStatus(pairing.pairingId, pairing.requestToken)
        .then(async (status) => {
          if (status.status === 'ACTIVE') {
            const active = await markDeviceAuthorizationStatus(deviceIdentity.deviceId, 'ACTIVE');
            if (active) setDeviceIdentity(active);
            await clearDevicePairing(pairing.pairingId);
            setPairing(null);
            setLoginError(null);
            return;
          }
          const next = { ...pairing, currentStatus: status.status };
          await saveDevicePairing(next, pairing.pairingId);
          setPairing(next);
        })
        .catch(() => undefined);
    poll();
    const timer = window.setInterval(poll, 2_000);
    return () => window.clearInterval(timer);
  }, [pairing?.pairingId, pairing?.requestToken]);

  useEffect(() => {
    const restore = async () => {
      if (!window.localStorage.getItem(sessionTokenStorageKey)) {
        setAuthChecking(false);
        return;
      }
      try {
        const current = await edge.getCurrentSession();
        if (!current.user.permissions.includes(PermissionCodes.KDS_VIEW)) {
          await edge.logout();
          clearLocalSession();
          return;
        }
        setAuthUser(current.user);
      } catch (problem) {
        if(invalidatesLocalSession(problem))clearLocalSession();
        else setLoginError(getKdsErrorMessage(problem));
      } finally {
        setAuthChecking(false);
      }
    };
    void restore();
  }, [clearLocalSession]);

  const refreshStations = useCallback(async () => {
    const next = await edge.getKdsStations();
    setStations(next);
    setStationsLoaded(true);
    if (!stationRef.current || !next.some((station) => station.stationId === stationRef.current))
      setConnection('CONNECTED');
    setStationId((current) => {
      if (current) return current; // Never silently redirect a cook to another station.
      const fromUrl = new URLSearchParams(window.location.search).get('stationId');
      const stored = window.localStorage.getItem('comanview-kds-station');
      return fromUrl ?? stored ?? next[0]?.stationId ?? '';
    });
  }, []);

  const refreshTickets = useCallback(
    async (selectedStation = stationRef.current) => {
      if (!selectedStation) return;
      const sequence = ++ticketRequest.current;
      try {
        const next = await edge.getKdsTickets(selectedStation);
        if (stationRef.current !== selectedStation || sequence !== ticketRequest.current) return;
        setTickets(next);
        setConnection('CONNECTED');
        setReadError(null);
      } catch (problem) {
        if (stationRef.current !== selectedStation || sequence !== ticketRequest.current) return;
        setConnection(
          problem instanceof EdgeClientError && problem.code !== 'EDGE_UNREACHABLE'
            ? 'CONNECTED'
            : 'DISCONNECTED',
        );
        setReadError(getKdsErrorMessage(problem));
        // Do not show inaccessible tickets as an authoritative board.
        if (problem instanceof EdgeClientError && problem.status === 403) setTickets([]);
        if (invalidatesLocalSession(problem)) clearLocalSession();
      }
    },
    [clearLocalSession],
  );

  useEffect(() => {
    if (!authUser) return;
    void refreshStations().catch((problem) => {
      setConnection(
        problem instanceof EdgeClientError && problem.code !== 'EDGE_UNREACHABLE'
          ? 'CONNECTED'
          : 'DISCONNECTED',
      );
      setReadError(getKdsErrorMessage(problem));
    });
  }, [authUser, refreshStations]);

  useEffect(() => {
    if (!stationId) return;
    setTickets([]);
    setConnection('CONNECTING');
    window.localStorage.setItem('comanview-kds-station', stationId);
    void refreshTickets(stationId);
  }, [stationId, refreshTickets]);

  useEffect(() => {
    if (!authUser) return;
    const clock = window.setInterval(() => setNow(Date.now()), 1_000);
    const fallback = window.setInterval(() => {
      void refreshStations()
        .then(() => refreshTickets())
        .catch((problem) => {
          setReadError(getKdsErrorMessage(problem));
          setConnection(
            problem instanceof EdgeClientError && problem.code !== 'EDGE_UNREACHABLE'
              ? 'CONNECTED'
              : 'DISCONNECTED',
          );
        });
    }, 5_000);
    return () => {
      window.clearInterval(clock);
      window.clearInterval(fallback);
    };
  }, [authUser, refreshStations, refreshTickets]);

  useEffect(() => {
    if (!authUser) return;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let stopped = false;
    let attempt = 0;
    const connect = () => {
      if (stopped) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(`${protocol}//${window.location.host}/api/realtime`);
      socket.onopen = () => {
        const sessionToken = window.localStorage.getItem(sessionTokenStorageKey);
        if (!sessionToken) {
          socket?.close();
          clearLocalSession();
          return;
        }
        socket?.send(JSON.stringify({ type: 'AUTHENTICATE', token: sessionToken }));
        attempt = 0;
      };
      socket.onmessage = (event) => {
        try {
          const raw = JSON.parse(String(event.data));
          if (raw?.type === 'AUTHENTICATED') {
            setRealtime(true);
            void refreshStations()
              .then(() => refreshTickets())
              .catch((problem) => setReadError(getKdsErrorMessage(problem)));
            return;
          }
          const parsed = KdsRealtimeMessageSchema.safeParse(raw);
          if (parsed.success && shouldRefreshForMessage(parsed.data, stationRef.current)) {
            void refreshTickets();
          }
        } catch {
          // Realtime is a notification channel; invalid payloads are ignored and fallback refetch remains active.
        }
      };
      socket.onerror = () => socket?.close();
      socket.onclose = (event) => {
        if (stopped) return;
        setRealtime(false);
        if(event?.code===1008){clearLocalSession();return;}
        reconnectTimer = window.setTimeout(connect, reconnectDelayMs(attempt++));
      };
    };
    connect();
    return () => {
      stopped = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [authUser, clearLocalSession, refreshStations, refreshTickets]);

  async function transition(ticket: KdsTicketResponse, target: 'PREPARING' | 'READY') {
    if (
      nextKitchenAction(ticket.status) !== target ||
      kitchenActionReason({
        busy: pendingTicket !== null,
        connected: connection === 'CONNECTED' && !readError,
        authorized: Boolean(authUser?.permissions.includes(PermissionCodes.KDS_UPDATE_PREPARATION)),
        stationAvailable:
          stations.some((station) => station.stationId === ticket.stationId) &&
          ticket.stationId === stationRef.current,
      })
    )
      return;
    transitionFocus.current = ticket.ticketId;
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
      if (invalidatesLocalSession(problem)) clearLocalSession();
      setError(getKdsErrorMessage(problem));
      await refreshTickets(ticket.stationId);
    } finally {
      setPendingTicket(null);
    }
  }

  const byStatus = useMemo(
    () =>
      Object.fromEntries(
        columns.map(({ status }) => [
          status,
          tickets.filter(
            (ticket) =>
              ticket.status === status &&
              ticket.stationId === stationId &&
              stations.some((station) => station.stationId === stationId),
          ),
        ]),
      ) as Record<KdsPreparationStatus, KdsTicketResponse[]>,
    [tickets, stationId, stations],
  );
  const selectedStation = stations.find((station) => station.stationId === stationId);
  const deviceOnboardingState = getDeviceOnboardingState(deviceIdentity, pairing);

  async function login(event: FormEvent) {
    event.preventDefault();
    if (pin.length < 4) return;
    setLoginPending(true);
    setLoginError(null);
    try {
      if (!deviceIdentity) {
        setLoginError('Este KDS no tiene un dispositivo configurado.');
        return;
      }
      const authenticated = await edge.login({
        pin,
        deviceId: deviceIdentity.deviceId,
        deviceCredential: deviceIdentity.credential,
      });
      if (!authenticated.user.permissions.includes(PermissionCodes.KDS_VIEW)) {
        window.localStorage.setItem(sessionTokenStorageKey, authenticated.token);
        await edge.logout();
        window.localStorage.removeItem(sessionTokenStorageKey);
        setLoginError('Este usuario no tiene acceso a KDS.');
        return;
      }
      window.localStorage.setItem(sessionTokenStorageKey, authenticated.token);
      const active = await markDeviceAuthorizationStatus(deviceIdentity.deviceId, 'ACTIVE');
      if (active) setDeviceIdentity(active);
      setAuthUser(authenticated.user);
      setPin('');
    } catch (problem) {
      setPin('');
      if (
        deviceIdentity &&
        problem instanceof EdgeClientError &&
        problem.code === 'DEVICE_REVOKED'
      ) {
        const revoked = await markDeviceAuthorizationStatus(deviceIdentity.deviceId, 'REVOKED');
        if (revoked) setDeviceIdentity(revoked);
      } else if (
        deviceIdentity &&
        problem instanceof EdgeClientError &&
        ['DEVICE_NOT_PAIRED', 'DEVICE_NOT_AUTHORIZED', 'DEVICE_CREDENTIAL_INVALID'].includes(
          problem.code,
        )
      ) {
        const unknown = await markDeviceAuthorizationStatus(deviceIdentity.deviceId, 'UNKNOWN');
        if (unknown) setDeviceIdentity(unknown);
      }
      setLoginError(
        problem instanceof EdgeClientError && problem.code === 'DEVICE_REVOKED'
          ? 'Este dispositivo fue revocado. Empáralo nuevamente para crear una identidad nueva.'
          : problem instanceof EdgeClientError &&
              ['DEVICE_NOT_PAIRED', 'DEVICE_NOT_AUTHORIZED', 'DEVICE_CREDENTIAL_INVALID'].includes(
                problem.code,
              )
            ? 'Este dispositivo no está autorizado. Empáralo primero.'
            : 'PIN incorrecto o acceso temporalmente bloqueado.',
      );
    } finally {
      setLoginPending(false);
    }
  }
  async function beginPairing() {
    if (!deviceIdentity || pairingPending) return;
    setPairingPending(true);
    setLoginError(null);
    try {
      const displayName = pairingDisplayName.trim();
      if (!displayName) {
        setLoginError('Asigna un nombre a este dispositivo.');
        return;
      }
      const named =
        deviceIdentity.displayName === displayName
          ? deviceIdentity
          : { ...deviceIdentity, displayName };
      if (named !== deviceIdentity) {
        await saveDeviceIdentity(named);
        setDeviceIdentity(named);
      }
      const requested = await requestPairingWithIdentityRotation({
        identity: named,
        requestPairing: (identity) =>
          edge.createPairing({
            deviceId: identity.deviceId,
            deviceType: 'KDS',
            displayName: identity.displayName,
            credential: identity.credential,
          }),
        onIdentityRotated: (identity) => setDeviceIdentity(identity),
      });
      const next = createClientDevicePairing(requested.pairing);
      await saveDevicePairing(next);
      setPairing(next);
    } catch (problem) {
      setLoginError(getKdsErrorMessage(problem));
    } finally {
      setPairingPending(false);
    }
  }
  async function retryPairing() {
    if (pairing) await clearDevicePairing(pairing.pairingId);
    setPairing(null);
    await beginPairing();
  }

  async function logout() {
    try {
      await edge.logout();
    } catch {
      // The display locks locally even if Edge became unavailable.
    } finally {
      clearLocalSession();
      setPin('');
      setLoginError(null);
    }
  }

  if (authChecking) {
    return <main className="kds-login-shell">Restaurando sesión local…</main>;
  }

  if (!authUser) {
    return (
      <main className="kds-login-shell">
        <form className="kds-login-card" onSubmit={(event) => void login(event)}>
          <span className="eyebrow">COMANVIEW KDS</span>
          <h1>Acceso de cocina</h1>
          <div className="kds-pin-display">{pin ? '•'.repeat(pin.length) : 'Ingresa tu PIN'}</div>
          <div className="kds-pin-keypad" aria-label="Teclado de PIN">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
              <button
                key={digit}
                type="button"
                disabled={loginPending || pin.length >= 12}
                onClick={() => setPin((current) => `${current}${digit}`)}
              >
                {digit}
              </button>
            ))}
            <button
              aria-label="Borrar último dígito"
              type="button"
              onClick={() => setPin((current) => current.slice(0, -1))}
            >
              ←
            </button>
            <button
              disabled={loginPending || pin.length >= 12}
              type="button"
              onClick={() => setPin((current) => `${current}0`)}
            >
              0
            </button>
            <button
              aria-label="Iniciar sesión"
              className="confirm"
              type="submit"
              disabled={loginPending || pin.length < 4}
            >
              {loginPending ? '…' : '✓'}
            </button>
          </div>
          <div className="kds-login-feedback" role="status">
            {loginError ?? '\u00a0'}
          </div>
          <DeviceOnboardingCard
            productLabel="KDS"
            state={deviceOnboardingState}
            displayName={pairingDisplayName}
            pairingCode={pairing?.pairingCode}
            pairingId={pairing?.pairingId}
            expiresAt={pairing?.expiresAt}
            pending={pairingPending}
            onDisplayName={setPairingDisplayName}
            onPair={() => void beginPairing()}
            onRetry={() => void retryPairing()}
          />
        </form>
      </main>
    );
  }

  return (
    <div className="kds-shell">
      <KitchenViewportNotice />
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
              aria-pressed={station.stationId === stationId}
              disabled={Boolean(pendingTicket)}
              onClick={() => {
                stationRef.current = station.stationId;
                setStationId(station.stationId);
                setError(null);
              }}
            >
              {station.name}
            </button>
          ))}
        </nav>
        <div className="kds-operator">
          <strong>{authUser.displayName}</strong>
          <span>Cocina</span>
          <button disabled={Boolean(pendingTicket)} type="button" onClick={() => void logout()}>
            Bloquear
          </button>
        </div>
      </header>

      <LocalConnectionStatus local={connection} realtime={realtime} />
      {stationsLoaded && !selectedStation && (
        <InlineAlert tone="warning" title="Estación no disponible">
          Selecciona una estación de la lista. Si no hay opciones, pide al responsable que configure
          una estación activa.
        </InlineAlert>
      )}
      {readError && (
        <InlineAlert urgent tone="error" title="No pudimos actualizar las comandas">
          {readError}
        </InlineAlert>
      )}
      {error && (
        <InlineAlert urgent tone="warning" title="Revisa la preparación">
          {error}
          <button onClick={() => setError(null)}>Entendido</button>
        </InlineAlert>
      )}
      <button
        className="refresh-board"
        disabled={Boolean(pendingTicket)}
        onClick={() => {
          setConnection('CONNECTING');
          void refreshStations()
            .then(() => refreshTickets())
            .catch((problem) => setReadError(getKdsErrorMessage(problem)));
        }}
      >
        Actualizar estación
      </button>
      <main className="board">
        {columns.map((column) => (
          <section key={column.status} className={`column ${column.status.toLowerCase()}`}>
            <header>
              <h2>{column.title}</h2>
              <strong>{byStatus[column.status].length}</strong>
            </header>
            <div className="ticket-list" tabIndex={0} role="region" aria-label={`Comandas: ${column.title}`}>
              {byStatus[column.status].map((ticket) => (
                <KitchenTicket
                  key={ticket.ticketId}
                  ticket={ticket}
                  now={now}
                  reason={kitchenActionReason({
                    busy: pendingTicket !== null,
                    connected: connection === 'CONNECTED' && !readError,
                    authorized: authUser.permissions.includes(
                      PermissionCodes.KDS_UPDATE_PREPARATION,
                    ),
                    stationAvailable: Boolean(selectedStation),
                  })}
                  onTransition={(target) => void transition(ticket, target)}
                />
              ))}
              {byStatus[column.status].length === 0 && (
                <div className="empty">
                  {!selectedStation
                    ? 'Selecciona una estación disponible'
                    : readError || connection !== 'CONNECTED'
                      ? 'Esperando datos vigentes'
                      : 'Sin comandas en este estado'}
                </div>
              )}
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}
