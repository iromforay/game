import { useEffect, useState } from 'react';
import { fetchAllRoundMaps } from 'strategy-marbles';
import type { RoundMapDef } from 'strategy-marbles';
import { useMultiplayer } from './MultiplayerContext';
import type { RoomVisibility } from './types';

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 9;
const PLAYER_COUNT_OPTIONS = Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => MIN_PLAYERS + i);

function floorFeel(friction: number): string {
  if (friction <= 3) return '미끄러움';
  if (friction <= 7) return '보통';
  return '거침';
}

type Step = 'server-select' | 'public-list' | 'private-menu' | 'create' | 'room';

interface MultiplayerLobbyProps {
  onExit: () => void;
}

export function MultiplayerLobby({ onExit }: MultiplayerLobbyProps) {
  const multiplayer = useMultiplayer();
  const [step, setStep] = useState<Step>('server-select');
  const [playerName, setPlayerName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [pendingVisibility, setPendingVisibility] = useState<RoomVisibility>('private');
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [roundMaps, setRoundMaps] = useState<RoundMapDef[] | null>(null);
  const [roundId, setRoundId] = useState(1);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    multiplayer.connect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (multiplayer.room) setStep('room');
  }, [multiplayer.room]);

  useEffect(() => {
    if (step === 'public-list') multiplayer.refreshPublicRooms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  useEffect(() => {
    if (step !== 'create') return;
    let cancelled = false;
    setRoundMaps(null);
    fetchAllRoundMaps().then((maps) => {
      if (!cancelled) setRoundMaps(maps);
    });
    return () => {
      cancelled = true;
    };
  }, [step]);

  const requireName = () => {
    if (!playerName.trim()) {
      setLocalError('닉네임을 입력해주세요.');
      return false;
    }
    setLocalError(null);
    return true;
  };

  const handleOpenCreate = (visibility: RoomVisibility) => {
    if (!requireName()) return;
    setPendingVisibility(visibility);
    setStep('create');
  };

  const handleCreateRoom = () => {
    multiplayer.createRoom({ name: playerName.trim(), visibility: pendingVisibility, maxPlayers, roundId });
  };

  const handleJoinRoom = (codeOverride?: string) => {
    const code = codeOverride ?? joinCode;
    if (!requireName()) return;
    if (!code.trim()) {
      setLocalError('참가 코드를 입력해주세요.');
      return;
    }
    multiplayer.joinRoom(code.trim(), playerName.trim());
  };

  const handleLeaveRoom = () => {
    multiplayer.leaveRoom();
    setStep('server-select');
  };

  const isHost = multiplayer.room?.players.find((p) => p.id === multiplayer.selfId)?.isHost ?? false;
  const backTarget: Step = pendingVisibility === 'public' ? 'public-list' : 'private-menu';

  if (multiplayer.connection !== 'connected') {
    return (
      <p className="placeholder-note">
        멀티플레이 서버에 연결하는 중...{multiplayer.error && <><br />{multiplayer.error}</>}
      </p>
    );
  }

  const nameField =
    step !== 'room' ? (
      <input
        type="text"
        placeholder="닉네임"
        value={playerName}
        onChange={(e) => setPlayerName(e.target.value)}
        className="multiplayer-input"
      />
    ) : null;

  if (step === 'room' && multiplayer.room) {
    const room = multiplayer.room;
    return (
      <div className="multiplayer-panel">
        <p>
          방 코드: <strong>{room.roomCode}</strong> ({room.visibility === 'public' ? '공개방' : '비공개방'}, 친구에게 이 코드를 알려주세요)
        </p>
        <ul className="multiplayer-player-list">
          {room.players.map((p) => (
            <li key={p.id}>
              {p.name}
              {p.isHost ? ' 👑' : ''}
              {p.id === multiplayer.selfId ? ' (나)' : ''}
            </li>
          ))}
        </ul>
        <p className="placeholder-note">
          {room.players.length}/{room.maxPlayers}명 참가 중
        </p>
        {isHost ? (
          <button type="button" className="round-select-button" onClick={() => multiplayer.startGame()}>
            게임 시작
          </button>
        ) : (
          <p className="placeholder-note">방장이 게임을 시작하길 기다리는 중...</p>
        )}
        <button type="button" className="round-select-button" onClick={handleLeaveRoom}>
          방 나가기
        </button>
        {(localError ?? multiplayer.error) && <p className="multiplayer-error">{localError ?? multiplayer.error}</p>}
      </div>
    );
  }

  if (step === 'create') {
    return (
      <div className="multiplayer-panel">
        <button type="button" className="exit-button" onClick={() => setStep(backTarget)}>
          ← 뒤로
        </button>
        <div className="marbles-screen-label">멀티모드 -{pendingVisibility === 'public' ? '공개서버' : '비공개서버'}-</div>
        {nameField}

        <label className="multiplayer-player-count">
          참가인원
          <select value={maxPlayers} onChange={(e) => setMaxPlayers(Number(e.target.value))} className="multiplayer-input">
            {PLAYER_COUNT_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}명
              </option>
            ))}
          </select>
        </label>

        <div>
          <h3>맵 선택</h3>
          {roundMaps ? (
            <table className="round-table">
              <thead>
                <tr>
                  <th>맵</th>
                  <th>바닥</th>
                  <th>기물 수</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {roundMaps.map((map) => {
                  const selected = map.id === roundId;
                  return (
                    <tr key={map.id} className={selected ? 'round-row-selected' : ''}>
                      <td>{map.name}</td>
                      <td>{floorFeel(map.floorFriction)}</td>
                      <td>{map.terrain.length}</td>
                      <td>
                        <button type="button" className="round-select-button" onClick={() => setRoundId(map.id)}>
                          {selected ? '선택됨' : '선택'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="placeholder-note">맵 목록을 불러오는 중...</p>
          )}
        </div>

        {(localError ?? multiplayer.error) && <p className="multiplayer-error">{localError ?? multiplayer.error}</p>}

        <button type="button" className="start-button" onClick={handleCreateRoom}>
          서버생성 및 입장
        </button>
      </div>
    );
  }

  if (step === 'public-list') {
    return (
      <div className="multiplayer-panel">
        <button type="button" className="exit-button" onClick={() => setStep('server-select')}>
          ← 뒤로
        </button>
        <div className="marbles-screen-label">멀티모드 -공개서버-</div>
        {nameField}

        <button type="button" className="round-select-button" onClick={() => handleOpenCreate('public')}>
          방 만들기
        </button>

        <div className="multiplayer-public-list">
          <h3>공개 게임 목록</h3>
          {multiplayer.publicRooms.length === 0 ? (
            <p className="placeholder-note">현재 열려있는 공개 게임이 없습니다.</p>
          ) : (
            <ul className="multiplayer-player-list">
              {multiplayer.publicRooms.map((r) => (
                <li key={r.roomCode} className="multiplayer-public-room">
                  <span>
                    {r.roomCode} · {r.players.find((p) => p.isHost)?.name ?? '???'}님의 방 · {r.players.length}/{r.maxPlayers}명
                  </span>
                  <button type="button" className="round-select-button" onClick={() => handleJoinRoom(r.roomCode)}>
                    참가
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {(localError ?? multiplayer.error) && <p className="multiplayer-error">{localError ?? multiplayer.error}</p>}
      </div>
    );
  }

  if (step === 'private-menu') {
    return (
      <div className="multiplayer-panel">
        <button type="button" className="exit-button" onClick={() => setStep('server-select')}>
          ← 뒤로
        </button>
        <div className="marbles-screen-label">멀티모드 -비공개서버-</div>
        {nameField}

        <div className="multiplayer-actions">
          <button type="button" className="round-select-button" onClick={() => handleOpenCreate('private')}>
            방 만들기
          </button>
          <input
            type="text"
            placeholder="참가 코드"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            className="multiplayer-input"
          />
          <button type="button" className="round-select-button" onClick={() => handleJoinRoom()}>
            코드로 참가
          </button>
        </div>
        {(localError ?? multiplayer.error) && <p className="multiplayer-error">{localError ?? multiplayer.error}</p>}
      </div>
    );
  }

  return (
    <div className="multiplayer-panel">
      <button type="button" className="exit-button" onClick={onExit}>
        ← 모드 선택으로
      </button>
      <div className="marbles-screen-label">멀티모드</div>
      {nameField}
      <div className="mode-select-list">
        <button type="button" className="mode-select-button" onClick={() => setStep('public-list')}>
          <span className="mode-select-title">공개서버</span>
          <span className="mode-select-desc">공개 게임 목록에서 골라 바로 참가</span>
        </button>
        <button type="button" className="mode-select-button" onClick={() => setStep('private-menu')}>
          <span className="mode-select-title">비공개서버</span>
          <span className="mode-select-desc">방을 만들거나 코드로 참가</span>
        </button>
      </div>
      {multiplayer.error && <p className="multiplayer-error">{multiplayer.error}</p>}
    </div>
  );
}
