import { useEffect, useRef, useState } from 'react';
import backdropUrl from './assets/forest-path-backdrop-v2.webp';
import './styles.css';

interface GreenTrackingSceneProps { onExit?: () => void }
type MoveMode = 'stop' | 'walk' | 'run';
const MODE_SPEED: Record<MoveMode, number> = { stop: 0, walk: 4.1, run: 8.2 };

export function GreenTrackingScene({ onExit }: GreenTrackingSceneProps) {
  const modeRef = useRef<MoveMode>('walk');
  const [mode, setMode] = useState<MoveMode>('walk');
  const [progress, setProgress] = useState(0);
  const [panelExpanded, setPanelExpanded] = useState(false);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  useEffect(() => {
    let frame = 0; let routeProgress = 0; let lastTime = performance.now(); let lastUpdate = lastTime;
    const animate = (now: number) => {
      frame = requestAnimationFrame(animate);
      const delta = Math.min((now - lastTime) / 1000, .05); lastTime = now;
      routeProgress = (routeProgress + delta * MODE_SPEED[modeRef.current]) % 100;
      if (now - lastUpdate > 120) { lastUpdate = now; setProgress(Math.round(routeProgress)); }
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, []);

  const backdropScale = 1.035 + progress * .00045;
  return <main className={`green-tracking-shell mode-${mode}`}><div className="forest-backdrop" role="img" aria-label="수양버들이 있는 실사형 숲길 산책 장면" style={{ backgroundImage: `url(${backdropUrl})`, transform: `scale(${backdropScale}) translateY(${progress * -.008}%)` }} /><div className="forest-vignette" />
    <header className="forest-topbar"><button type="button" onClick={onExit ?? (() => history.back())}>← 허브</button><div><small>GAME 08 · VISUAL MVP</small><strong>GREEN TRACKING</strong></div><span>숲속길 · 맑은 낮</span></header>
    <section id="walk-controls" className={`walk-panel${panelExpanded ? ' expanded' : ' collapsed'}`}>
      <button className="walk-panel-toggle" type="button" aria-expanded={panelExpanded} aria-controls="walk-panel-details" onClick={() => setPanelExpanded((expanded) => !expanded)}>
        <span className="walk-panel-summary"><small>SCENE TEST 01</small><strong>오래된 수양버들 길</strong></span>
        <span className="walk-mode-chip">{mode === 'stop' ? '멈춤' : mode === 'run' ? '달리기' : '걷기'}</span>
        <span className="walk-toggle-icon" aria-hidden="true">{panelExpanded ? '⌄' : '⌃'}</span>
      </button>
      <div className="walk-progress"><i><b style={{ width: `${progress}%` }} /></i><span>{progress}%</span></div>
      <div id="walk-panel-details" className="walk-panel-details" aria-hidden={!panelExpanded}>
        <p>갈대와 잡풀 사이를 걷습니다.</p>
        <div className="move-modes">{([['stop', '멈춤'], ['walk', '걷기'], ['run', '달리기']] as const).map(([value, label]) => <button key={value} type="button" className={mode === value ? 'active' : ''} onClick={() => { setMode(value); setPanelExpanded(false); }}><strong>{label}</strong><small>{value === 'walk' ? '가벼운 산책' : value === 'run' ? '구보' : '풍경 감상'}</small></button>)}</div>
      </div>
    </section><p className="mvp-note">풍경의 깊이감 · 식생이 스쳐 지나가는 속도 · 수양버들의 존재감을 확인하는 1씬 MVP</p><div className="ai-image-credit" aria-label="배경 이미지 출처">OpenAI 생성형 이미지</div></main>;
}
