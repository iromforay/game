import { useEffect, useRef, useState } from 'react';
import backdropUrl from './assets/forest-path-clean-v3.webp';
import treeUrl from './assets/photoreal-deciduous-tree.png';
import grassUrl from './assets/photoreal-wild-grass.png';
import reedsUrl from './assets/photoreal-reeds.png';
import willowUrl from './assets/photoreal-willow.png';
import './styles.css';

interface GreenTrackingSceneProps { onExit?: () => void }
type MoveMode = 'stop' | 'walk' | 'run';
const MODE_SPEED: Record<MoveMode, number> = { stop: 0, walk: 4.1, run: 8.2 };
const OBJECTS = [
  { kind: 'grass', side: -1, offset: 3, size: .52 }, { kind: 'tree', side: 1, offset: 11, size: .72 },
  { kind: 'reeds', side: -1, offset: 20, size: .64 }, { kind: 'grass', side: 1, offset: 29, size: .46 },
  { kind: 'tree', side: -1, offset: 38, size: .68 }, { kind: 'reeds', side: 1, offset: 47, size: .58 },
  { kind: 'willow', side: -1, offset: 57, size: .86 }, { kind: 'grass', side: 1, offset: 67, size: .5 },
  { kind: 'tree', side: 1, offset: 77, size: .7 }, { kind: 'reeds', side: -1, offset: 87, size: .6 },
  { kind: 'grass', side: -1, offset: 95, size: .48 },
] as const;
const OBJECT_ASSETS = { tree: treeUrl, grass: grassUrl, reeds: reedsUrl, willow: willowUrl };

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

  return <main className={`green-tracking-shell mode-${mode}`}><div className="forest-backdrop" role="img" aria-label="나무와 갈대가 없는 실사형 오솔길 배경" style={{ backgroundImage: `url(${backdropUrl})` }} />
    <div className="passing-objects" aria-hidden="true">{OBJECTS.map((object, index) => {
      const depth = ((progress + object.offset) % 100) / 100;
      const approach = depth * depth;
      const x = 50 + object.side * (4 + Math.pow(depth, 1.55) * 57);
      const y = 44 + Math.pow(depth, 1.7) * 63;
      const scale = (.09 + approach * 1.38) * object.size;
      const opacity = Math.min(1, depth * 8, (1 - depth) * 7);
      return <img key={`${object.kind}-${index}`} src={OBJECT_ASSETS[object.kind]} alt="" className={`passing-object passing-${object.kind}`} style={{ left: `${x}%`, top: `${y}%`, opacity, transform: `translate(-50%, -100%) scale(${scale}) scaleX(${object.side < 0 ? -1 : 1})`, zIndex: 10 + Math.round(depth * 80) }} />;
    })}</div><div className="forest-vignette" />
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
