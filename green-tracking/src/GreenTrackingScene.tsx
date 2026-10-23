import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import backdropUrl from './assets/forest-path-backdrop.webp';
import treeUrl from './assets/photoreal-deciduous-tree.png';
import grassUrl from './assets/photoreal-wild-grass.png';
import reedsUrl from './assets/photoreal-reeds.png';
import willowUrl from './assets/photoreal-willow.png';
import './styles.css';

interface GreenTrackingSceneProps { onExit?: () => void }
type MoveMode = 'stop' | 'walk' | 'run';
const MODE_SPEED: Record<MoveMode, number> = { stop: 0, walk: 4.1, run: 8.2 };

const random = (() => { let seed = 8217; return () => { seed = seed * 16807 % 2147483647; return (seed - 1) / 2147483646; }; })();

function makePhotoCard(texture: THREE.Texture, width: number, height: number, x: number, z: number, scale = 1, flip = false) {
  const group = new THREE.Group();
  const geometry = new THREE.PlaneGeometry(width, height);
  geometry.translate(0, height / 2, 0);
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: .08, side: THREE.DoubleSide, depthWrite: true, toneMapped: false });
  [-.11, .11].forEach((turn, index) => {
    const plane = new THREE.Mesh(geometry, index ? material.clone() : material);
    plane.rotation.y = turn; plane.position.z = index ? -.035 : .035; plane.scale.x = flip ? -1 : 1; group.add(plane);
  });
  group.position.set(x, 0, z); group.scale.setScalar(scale); group.userData.sway = random() * Math.PI * 2;
  return group;
}

export function GreenTrackingScene({ onExit }: GreenTrackingSceneProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef<MoveMode>('walk');
  const [mode, setMode] = useState<MoveMode>('walk');
  const [progress, setProgress] = useState(0);
  const [panelExpanded, setPanelExpanded] = useState(false);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  useEffect(() => {
    const mount = mountRef.current; if (!mount) return;
    const scene = new THREE.Scene(); scene.background = null; scene.fog = new THREE.FogExp2(0xc7dcca, .018);
    const camera = new THREE.PerspectiveCamera(58, 1, .1, 180); camera.position.set(0, 2.05, 8);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05; mount.appendChild(renderer.domElement);
    const photoLayers: THREE.Group[] = [];
    const loader = new THREE.TextureLoader(); let disposed = false;
    Promise.all([treeUrl, grassUrl, reedsUrl, willowUrl].map((url) => loader.loadAsync(url))).then(([treeTexture, grassTexture, reedsTexture, willowTexture]) => {
      if (disposed) return;
      [treeTexture, grassTexture, reedsTexture, willowTexture].forEach((texture) => { texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = renderer.capabilities.getMaxAnisotropy(); });
      for (let i = 0; i < 32; i += 1) { const side = i % 2 ? 1 : -1; photoLayers.push(makePhotoCard(treeTexture, 6.4, 10, side * (5.1 + random() * 12), 6 - random() * 132, .72 + random() * .68, random() > .5)); }
      for (let i = 0; i < 54; i += 1) { const side = i % 2 ? 1 : -1; photoLayers.push(makePhotoCard(reedsTexture, 4.2, 2.8, side * (3.2 + random() * 7), 7 - random() * 135, .72 + random() * .62, random() > .5)); }
      for (let i = 0; i < 82; i += 1) { const side = i % 2 ? 1 : -1; photoLayers.push(makePhotoCard(grassTexture, 4.6, 2.3, side * (2.4 + random() * 6), 8 - random() * 137, .42 + random() * .5, random() > .5)); }
      photoLayers.push(makePhotoCard(willowTexture, 11.2, 12, 5.7, -48, 1.08));
      photoLayers.forEach((layer) => scene.add(layer));
    });
    const clock = new THREE.Clock(); let cameraZ = 8; let frame = 0; let lastUpdate = 0;
    const resize = () => { const { clientWidth, clientHeight } = mount; renderer.setSize(clientWidth, clientHeight, false); camera.aspect = clientWidth / Math.max(1, clientHeight); camera.updateProjectionMatrix(); };
    const observer = new ResizeObserver(resize); observer.observe(mount); resize();
    const animate = () => {
      frame = requestAnimationFrame(animate); const delta = Math.min(clock.getDelta(), .04); const elapsed = clock.elapsedTime; const activeMode = modeRef.current;
      cameraZ -= delta * MODE_SPEED[activeMode]; if (cameraZ < -91) cameraZ = 8;
      const bobRate = activeMode === 'run' ? 9 : 5.2; const bobAmount = activeMode === 'stop' ? 0 : activeMode === 'run' ? .055 : .025;
      camera.position.set(Math.sin(elapsed * .72) * (activeMode === 'stop' ? 0 : .045), 2.05 + Math.sin(elapsed * bobRate) * bobAmount, cameraZ); camera.lookAt(camera.position.x * .3, 1.75, cameraZ - 16);
      photoLayers.forEach((layer, index) => { layer.rotation.z = Math.sin(elapsed * .72 + (layer.userData.sway as number)) * (index === photoLayers.length - 1 ? .003 : .006); });
      if (elapsed - lastUpdate > .15) { lastUpdate = elapsed; setProgress(Math.round((8 - cameraZ) / 99 * 100)); }
      renderer.render(scene, camera);
    }; animate();
    return () => { disposed = true; cancelAnimationFrame(frame); observer.disconnect(); scene.traverse((object) => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); const materials = Array.isArray(object.material) ? object.material : [object.material]; materials.forEach((material) => { if (material instanceof THREE.MeshBasicMaterial) material.map?.dispose(); material.dispose(); }); } }); renderer.dispose(); mount.removeChild(renderer.domElement); };
  }, []);

  return <main className="green-tracking-shell"><div ref={mountRef} className="forest-scene" style={{ backgroundImage: `url(${backdropUrl})` }} aria-label="수양버들이 있는 3D 숲길 산책 장면" /><div className="forest-vignette" />
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
