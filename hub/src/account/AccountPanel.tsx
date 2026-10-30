import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { ensureHubJwt, fetchSession, hasStoredToken, login, logout, register } from './accountClient';
import type { AccountSession } from './accountClient';
import './AccountPanel.css';

type Mode = 'login' | 'register';

// 허브 공통 계정(2026-09-28) — 대시보드 상단의 로그인 영역.
// 로그인/로그아웃 후에는 페이지를 새로고침한다: 게임 모듈(예: 커비 네트워크)이 앱 부팅 때 한 번 identify하고
// 연결을 유지하므로, 새 계정 기준으로 다시 식별하려면 새로고침이 가장 단순하고 확실하다.
interface Props {
  onSession?: (session: AccountSession | null) => void;
}

export function AccountPanel({ onSession }: Props) {
  const [session, setSession] = useState<AccountSession | null>(null);
  const [checking, setChecking] = useState(hasStoredToken());
  const [mode, setMode] = useState<Mode | null>(null);
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const returnUrl = (() => {
    const value = new URLSearchParams(location.search).get('returnUrl');
    if (!value) return null;
    try {
      const url = new URL(value, location.origin);
      const allowed = url.origin === location.origin || (url.protocol === 'https:' && (url.hostname === 'bomul.ai.kr' || url.hostname.endsWith('.bomul.ai.kr')));
      return allowed ? url.href : null;
    } catch { return null; }
  })();

  useEffect(() => {
    if (location.pathname === '/logout') {
      setBusy(true);
      void logout().finally(() => { location.href = returnUrl ?? '/'; });
      return;
    }
    if (location.pathname === '/login') setMode('login');
    if (!hasStoredToken()) return;
    void ensureHubJwt().catch(() => null).then(() => fetchSession()).then((s) => {
      setSession(s);
      setChecking(false);
      onSession?.(s);
      if (s && location.pathname === '/login' && returnUrl) location.href = returnUrl;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openForm = (next: Mode) => {
    setMode(next);
    setError('');
    setPassword('');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!mode || busy) return;
    setBusy(true);
    setError('');
    try {
      if (mode === 'login') await login(loginId, password);
      else await register(loginId, password, nickname);
      if (returnUrl) location.href = returnUrl;
      else location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : '요청에 실패했습니다');
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    setBusy(true);
    await logout();
    location.reload();
  };

  if (checking) return <p className="account-bar">계정 확인 중…</p>;

  return (
    <>
      <div className="account-bar">
        {session ? (
          <>
            <span className="account-name">
              <strong>{session.nickname}</strong> ({session.loginId})
            </span>
            <button type="button" className="account-link" onClick={handleLogout} disabled={busy}>
              로그아웃
            </button>
          </>
        ) : (
          <>
            <span className="account-guest">게스트로 플레이 중 · 로그인하면 다른 기기에서도 이어서 플레이할 수 있어요</span>
            <button type="button" className="account-link" onClick={() => openForm('login')}>
              로그인
            </button>
            <button type="button" className="account-link" onClick={() => openForm('register')}>
              회원가입
            </button>
          </>
        )}
      </div>

      {mode && (
        <div className="account-modal-backdrop" onClick={() => !busy && setMode(null)}>
          <form className="account-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
            <h2>{mode === 'login' ? '로그인' : '회원가입'}</h2>
            <label>
              아이디
              <input value={loginId} onChange={(e) => setLoginId(e.target.value)} autoComplete="username" placeholder="영문 소문자·숫자·밑줄 4~20자" required />
            </label>
            <label>
              비밀번호
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                placeholder="6~64자"
                required
              />
            </label>
            {mode === 'register' && (
              <label>
                닉네임
                <input value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={12} placeholder="비우면 아이디 사용 (12자 이하)" />
              </label>
            )}
            {mode === 'register' && <p className="account-note">이 기기에서 게스트로 플레이한 게임 기록은 계정으로 이어집니다.</p>}
            {error && <p className="account-error">{error}</p>}
            <div className="account-actions">
              <button type="button" onClick={() => setMode(null)} disabled={busy}>
                취소
              </button>
              <button type="submit" className="account-primary" disabled={busy}>
                {busy ? '처리 중…' : mode === 'login' ? '로그인' : '가입하기'}
              </button>
            </div>
            <button type="button" className="account-switch" onClick={() => openForm(mode === 'login' ? 'register' : 'login')} disabled={busy}>
              {mode === 'login' ? '계정이 없나요? 회원가입' : '이미 계정이 있나요? 로그인'}
            </button>
          </form>
        </div>
      )}
    </>
  );
}
