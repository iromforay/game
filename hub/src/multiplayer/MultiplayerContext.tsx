import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { AckResponse, ListRoomsResponse, RoomState, RoomVisibility } from './types';

const SERVER_URL = import.meta.env.VITE_MULTIPLAYER_SERVER_URL ?? 'http://localhost:3001';

export type ConnectionState = 'idle' | 'connecting' | 'connected';

interface CreateRoomOptions {
  name: string;
  visibility: RoomVisibility;
  maxPlayers: number;
  roundId: number;
}

interface MultiplayerContextValue {
  connection: ConnectionState;
  selfId: string | null;
  room: RoomState | null;
  publicRooms: RoomState[];
  error: string | null;
  connect: () => void;
  refreshPublicRooms: () => void;
  createRoom: (opts: CreateRoomOptions) => Promise<AckResponse>;
  joinRoom: (roomCode: string, name: string) => Promise<AckResponse>;
  leaveRoom: () => void;
  startGame: () => Promise<AckResponse>;
  getSocket: () => Socket | null;
  clearError: () => void;
}

const MultiplayerContext = createContext<MultiplayerContextValue | null>(null);

// Lives above the screen router (see main.tsx) so the socket survives the
// Lobby -> GameScreen transition when a match actually starts - a plain
// per-component connection (as MultiplayerLobby used to own) would drop the
// moment the lobby unmounts.
export function MultiplayerProvider({ children }: { children: ReactNode }) {
  const socketRef = useRef<Socket | null>(null);
  const [connection, setConnection] = useState<ConnectionState>('idle');
  const [selfId, setSelfId] = useState<string | null>(null);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [publicRooms, setPublicRooms] = useState<RoomState[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refreshPublicRooms = useCallback(() => {
    socketRef.current?.emit('listPublicRooms', undefined, (res: ListRoomsResponse) => {
      if (res.ok && res.rooms) setPublicRooms(res.rooms);
    });
  }, []);

  const connect = useCallback(() => {
    if (socketRef.current) return;
    setConnection('connecting');
    // Start on polling and let engine.io upgrade to websocket once it
    // confirms the upgrade actually works - some mobile carrier networks
    // block/break the WS upgrade outright, and websocket-only here means a
    // single failed upgrade kills the connection with no fallback.
    const socket = io(SERVER_URL, { transports: ['polling', 'websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      setSelfId(socket.id ?? null);
      setConnection('connected');
      refreshPublicRooms();
    });
    socket.on('connect_error', () => {
      setError('멀티플레이 서버에 연결할 수 없습니다. BE 서버가 켜져 있는지 확인해주세요.');
    });
    socket.on('disconnect', () => {
      setConnection('idle');
      setRoom(null);
    });
    socket.on('roomUpdated', (state: RoomState) => setRoom(state));
    socket.on('publicRoomsUpdated', (rooms: RoomState[]) => setPublicRooms(rooms));
    socket.on('gameStarted', (state: RoomState) => setRoom(state));
  }, []);

  useEffect(() => {
    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  const createRoom = useCallback((opts: CreateRoomOptions) => {
    return new Promise<AckResponse>((resolve) => {
      setError(null);
      socketRef.current?.emit('createRoom', opts, (res: AckResponse) => {
        if (res.ok && res.state) setRoom(res.state);
        else setError(res.error ?? '방 생성에 실패했습니다.');
        resolve(res);
      });
    });
  }, []);

  const joinRoom = useCallback((roomCode: string, name: string) => {
    return new Promise<AckResponse>((resolve) => {
      setError(null);
      socketRef.current?.emit('joinRoom', { roomCode, name }, (res: AckResponse) => {
        if (res.ok && res.state) setRoom(res.state);
        else setError(res.error ?? '참가에 실패했습니다.');
        resolve(res);
      });
    });
  }, []);

  const leaveRoom = useCallback(() => {
    socketRef.current?.emit('leaveRoom');
    setRoom(null);
    setError(null);
  }, []);

  const startGame = useCallback(() => {
    return new Promise<AckResponse>((resolve) => {
      setError(null);
      socketRef.current?.emit('startGame', {}, (res: AckResponse) => {
        if (!res.ok) setError(res.error ?? '게임 시작에 실패했습니다.');
        resolve(res);
      });
    });
  }, []);

  const getSocket = useCallback(() => socketRef.current, []);
  const clearError = useCallback(() => setError(null), []);

  return (
    <MultiplayerContext.Provider
      value={{
        connection,
        selfId,
        room,
        publicRooms,
        error,
        connect,
        refreshPublicRooms,
        createRoom,
        joinRoom,
        leaveRoom,
        startGame,
        getSocket,
        clearError,
      }}
    >
      {children}
    </MultiplayerContext.Provider>
  );
}

export function useMultiplayer(): MultiplayerContextValue {
  const ctx = useContext(MultiplayerContext);
  if (!ctx) throw new Error('useMultiplayer must be used within a MultiplayerProvider');
  return ctx;
}
