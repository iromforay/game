import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import treeUrl from './assets/models/tree-small.glb?url';
import shrubUrl from './assets/models/shrub.glb?url';
import fernUrl from './assets/models/fern.glb?url';
import dirtDiffuseUrl from './assets/textures/dirt/diffuse.jpg';
import dirtNormalUrl from './assets/textures/dirt/normal.jpg';
import dirtRoughnessUrl from './assets/textures/dirt/roughness.jpg';
import forestDiffuseUrl from './assets/textures/forest-ground/diffuse.jpg';
import forestNormalUrl from './assets/textures/forest-ground/normal.jpg';
import forestRoughnessUrl from './assets/textures/forest-ground/roughness.jpg';
import forestWindUrl from './assets/audio/runtime/ambience/forest-wind-loop.ogg?url';
import bird01Url from './assets/audio/runtime/birds/birds-distant-01.ogg?url';
import bird02Url from './assets/audio/runtime/birds/birds-distant-02.ogg?url';
import './styles.css';

const grassStepUrls = Object.values(import.meta.glob('./assets/audio/runtime/footsteps/grass/*.ogg', { eager: true, query: '?url', import: 'default' })) as string[];

interface Props { onExit?: () => void }
type MoveMode = 'stop' | 'walk' | 'run';
const SPEED: Record<MoveMode, number> = { stop: 0, walk: 2.6, run: 6.2 };

function seededRandom(seed = 8217) {
  return () => { seed = seed * 16807 % 2147483647; return (seed - 1) / 2147483646; };
}

function normalizedClone(source: THREE.Object3D, targetHeight: number) {
  const clone = source.clone(true);
  const box = new THREE.Box3().setFromObject(clone);
  clone.scale.setScalar(targetHeight / Math.max(.001, box.max.y - box.min.y));
  clone.updateMatrixWorld(true);
  clone.position.y -= new THREE.Box3().setFromObject(clone).min.y;
  clone.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = true; object.receiveShadow = true;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => { material.side = THREE.DoubleSide; material.alphaTest = .32; });
  });
  return clone;
}

export function GreenTrackingScene({ onExit }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef<MoveMode>('walk');
  const [mode, setMode] = useState<MoveMode>('walk');
  const [progress, setProgress] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const audioControlRef = useRef<{ enable: () => void; disable: () => void } | null>(null);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  useEffect(() => {
    const mount = mountRef.current; if (!mount) return;
    const random = seededRandom();
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0xaec8ce); scene.fog = new THREE.FogExp2(0x9fb4a5, .009);
    const camera = new THREE.PerspectiveCamera(54, 1, .1, 180); camera.position.set(0, 1.72, 8);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.22;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; mount.appendChild(renderer.domElement);

    const pointers = new Map<number, { x: number; y: number }>();
    let targetYaw = 0; let currentYaw = 0; let targetFov = 54; let pinchDistance = 0;
    const pointerDown = (event: PointerEvent) => { pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); renderer.domElement.setPointerCapture(event.pointerId); };
    const pointerMove = (event: PointerEvent) => {
      const previous = pointers.get(event.pointerId); if (!previous) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 1) targetYaw = THREE.MathUtils.clamp(targetYaw - (event.clientX - previous.x) * .0045, -.6, .6);
      if (pointers.size === 2) { const [a, b] = [...pointers.values()]; const distance = Math.hypot(a.x - b.x, a.y - b.y); if (pinchDistance) targetFov = THREE.MathUtils.clamp(targetFov - (distance - pinchDistance) * .045, 40, 58); pinchDistance = distance; }
    };
    const pointerUp = (event: PointerEvent) => { pointers.delete(event.pointerId); pinchDistance = 0; };
    const wheel = (event: WheelEvent) => { event.preventDefault(); targetFov = THREE.MathUtils.clamp(targetFov + event.deltaY * .018, 40, 58); };
    renderer.domElement.addEventListener('pointerdown', pointerDown); renderer.domElement.addEventListener('pointermove', pointerMove);
    renderer.domElement.addEventListener('pointerup', pointerUp); renderer.domElement.addEventListener('pointercancel', pointerUp); renderer.domElement.addEventListener('wheel', wheel, { passive: false });

    const wind = new Audio(forestWindUrl); wind.loop = true; wind.volume = .3; wind.preload = 'auto';
    const birdSounds = [bird01Url, bird02Url].map((url) => { const sound = new Audio(url); sound.volume = .22; sound.preload = 'auto'; return sound; });
    const stepSounds = grassStepUrls.map((url) => { const sound = new Audio(url); sound.volume = .5; sound.preload = 'auto'; return sound; });
    let soundOn = false; let birdTimer = 0; let lastStepAt = 0; let lastStepIndex = -1;
    const scheduleBird = () => { window.clearTimeout(birdTimer); if (!soundOn) return; birdTimer = window.setTimeout(() => { const bird = birdSounds[Math.floor(Math.random() * birdSounds.length)]; bird.currentTime = 0; bird.playbackRate = .96 + Math.random() * .08; void bird.play(); scheduleBird(); }, 9000 + Math.random() * 13000); };
    const enableAudio = () => { soundOn = true; void wind.play(); scheduleBird(); };
    const disableAudio = () => { soundOn = false; wind.pause(); birdSounds.forEach((sound) => sound.pause()); window.clearTimeout(birdTimer); };
    audioControlRef.current = { enable: enableAudio, disable: disableAudio };

    const sky = new THREE.Mesh(new THREE.SphereGeometry(130, 32, 18), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false,
      uniforms: { topColor: { value: new THREE.Color(0x86a7b5) }, bottomColor: { value: new THREE.Color(0xe1e6da) } },
      vertexShader: 'varying float h;void main(){vec4 w=modelMatrix*vec4(position,1.);h=normalize(w.xyz).y;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: 'uniform vec3 topColor;uniform vec3 bottomColor;varying float h;void main(){float t=smoothstep(-.12,.55,h);gl_FragColor=vec4(mix(bottomColor,topColor,t),1.);}' }));
    scene.add(sky, new THREE.HemisphereLight(0xf0f5ef, 0x30452f, 2.2), new THREE.AmbientLight(0xc8d8cc, .34));
    const sun = new THREE.DirectionalLight(0xfff0ce, 2.35); sun.position.set(-18, 25, 10); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -24; sun.shadow.camera.right = 24; sun.shadow.camera.top = 28; sun.shadow.camera.bottom = -12; scene.add(sun);

    const tl = new THREE.TextureLoader(); const [diffuse, normal, roughness] = [dirtDiffuseUrl, dirtNormalUrl, dirtRoughnessUrl].map((url) => tl.load(url));
    const [forestDiffuse, forestNormal, forestRoughness] = [forestDiffuseUrl, forestNormalUrl, forestRoughnessUrl].map((url) => tl.load(url));
    [diffuse, normal, roughness].forEach((t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2.2, 54); t.anisotropy = renderer.capabilities.getMaxAnisotropy(); }); diffuse.colorSpace = THREE.SRGBColorSpace;
    [forestDiffuse, forestNormal, forestRoughness].forEach((t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(13, 42); t.anisotropy = renderer.capabilities.getMaxAnisotropy(); }); forestDiffuse.colorSpace = THREE.SRGBColorSpace;
    const groundGeometry = new THREE.PlaneGeometry(54, 180, 36, 100);
    const groundPositions = groundGeometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < groundPositions.count; i += 1) {
      const x = groundPositions.getX(i); const z = groundPositions.getY(i);
      const awayFromPath = THREE.MathUtils.smoothstep(Math.abs(x), 2.4, 15);
      const height = awayFromPath * (.2 + Math.sin(z * .12 + x * .3) * .18 + Math.cos(z * .055 - x * .43) * .14);
      groundPositions.setZ(i, height);
    }
    groundGeometry.computeVertexNormals();
    const ground = new THREE.Mesh(groundGeometry, new THREE.MeshStandardMaterial({ map: forestDiffuse, normalMap: forestNormal, roughnessMap: forestRoughness, color: 0x9fb88b, roughness: 1 })); ground.rotation.x = -Math.PI / 2; ground.position.z = -76; ground.receiveShadow = true; scene.add(ground);
    const path = new THREE.Mesh(new THREE.PlaneGeometry(3.25, 180), new THREE.MeshStandardMaterial({ map: diffuse, normalMap: normal, roughnessMap: roughness, color: 0xb9ac92, roughness: 1 })); path.rotation.x = -Math.PI / 2; path.position.set(0, .018, -76); path.receiveShadow = true; scene.add(path);

    let disposed = false; const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
    Promise.all([treeUrl, shrubUrl, fernUrl].map((url) => loader.loadAsync(url))).then(([tree, shrub, fern]) => {
      if (disposed) return;
      const place = (source: THREE.Object3D, count: number, heights: [number, number], minX: number, maxX: number) => {
        for (let i = 0; i < count; i += 1) { const side = i % 2 ? 1 : -1; const object = normalizedClone(source, heights[0] + random() * (heights[1] - heights[0])); object.position.x += side * (minX + random() * (maxX - minX)); object.position.z = 6 - ((i + random() * .82) / count) * 164; object.rotation.y = random() * Math.PI * 2; scene.add(object); }
      };
      // Two overlapping tree strata keep branches and leaf clusters touching,
      // while the lower shrubs conceal repeated trunks and empty ground.
      place(tree.scene, 150, [11.5, 18], 2.75, 13);
      place(tree.scene, 96, [5.5, 10.5], 2.15, 9);
      place(shrub.scene, 230, [1.3, 3.7], 1.9, 8);
      place(shrub.scene, 130, [.55, 1.25], 1.65, 4.8);
      place(fern.scene, 290, [.55, 1.45], 1.55, 6.5);
      setLoading(false);
    }).catch((error) => { console.error('3D forest assets failed', error); setLoading(false); });

    const resize = () => { renderer.setSize(mount.clientWidth, mount.clientHeight, false); camera.aspect = mount.clientWidth / Math.max(1, mount.clientHeight); camera.updateProjectionMatrix(); };
    const observer = new ResizeObserver(resize); observer.observe(mount); resize();
    const clock = new THREE.Clock(); let frame = 0; let cameraZ = 8; let lastUpdate = 0;
    const animate = () => { frame = requestAnimationFrame(animate); const delta = Math.min(clock.getDelta(), .04); const elapsed = clock.elapsedTime; const active = modeRef.current; cameraZ -= delta * SPEED[active]; if (cameraZ < -142) cameraZ = 8; const moving = active !== 'stop'; const run = active === 'run'; camera.position.set(moving ? Math.sin(elapsed * (run ? 2.1 : 1.2)) * .055 : 0, 1.72 + (moving ? Math.sin(elapsed * (run ? 10 : 5.4)) * (run ? .055 : .022) : 0), cameraZ); currentYaw = THREE.MathUtils.damp(currentYaw, targetYaw, 9, delta); camera.fov = THREE.MathUtils.damp(camera.fov, targetFov, 10, delta); camera.updateProjectionMatrix(); camera.lookAt(camera.position.x + Math.sin(currentYaw) * 17, 1.28, cameraZ - Math.cos(currentYaw) * 17); if (soundOn && moving && elapsed - lastStepAt > (run ? .32 : .56)) { lastStepAt = elapsed; let next = Math.floor(Math.random() * stepSounds.length); if (next === lastStepIndex) next = (next + 1) % stepSounds.length; lastStepIndex = next; const step = stepSounds[next]; step.currentTime = 0; step.playbackRate = .88 + Math.random() * .1; step.volume = (run ? .46 : .34) * (.9 + Math.random() * .1); void step.play(); } if (elapsed - lastUpdate > .12) { lastUpdate = elapsed; setProgress(Math.round((8 - cameraZ) / 150 * 100)); } renderer.render(scene, camera); };
    animate();
    return () => { disposed = true; disableAudio(); audioControlRef.current = null; cancelAnimationFrame(frame); observer.disconnect(); renderer.domElement.removeEventListener('pointerdown', pointerDown); renderer.domElement.removeEventListener('pointermove', pointerMove); renderer.domElement.removeEventListener('pointerup', pointerUp); renderer.domElement.removeEventListener('pointercancel', pointerUp); renderer.domElement.removeEventListener('wheel', wheel); scene.traverse((object) => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => material.dispose()); } }); [diffuse, normal, roughness, forestDiffuse, forestNormal, forestRoughness].forEach((texture) => texture.dispose()); renderer.dispose(); mount.removeChild(renderer.domElement); };
  }, []);

  return <main className="green-tracking-shell"><div ref={mountRef} className="forest-scene" aria-label="실제 3D 식생과 PBR 오솔길로 구성한 숲길 산책 장면" /><div className="forest-vignette" />
    {loading && <div className="forest-loading"><i /><span>숲길을 준비하고 있습니다</span></div>}
    <header className="forest-topbar"><button type="button" onClick={onExit ?? (() => history.back())}>← 허브</button><div><small>GAME 08 · AUDIOVISUAL MVP</small><strong>GREEN TRACKING</strong></div><span>숲속길 · 흐린 낮</span></header>
    <button className={`sound-toggle${audioEnabled ? ' active' : ''}`} type="button" aria-pressed={audioEnabled} onClick={() => { if (audioEnabled) audioControlRef.current?.disable(); else audioControlRef.current?.enable(); setAudioEnabled((value) => !value); }}>{audioEnabled ? '🔊 소리 켬' : '♪ 소리와 걷기'}</button>
    <section className={`walk-panel${expanded ? ' expanded' : ' collapsed'}`}><button className="walk-panel-toggle" type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}><span className="walk-panel-summary"><small>SCENE TEST 02</small><strong>고요한 숲속 오솔길</strong></span><span className="walk-mode-chip">{mode === 'stop' ? '멈춤' : mode === 'run' ? '달리기' : '걷기'}</span><span className="walk-toggle-icon">{expanded ? '⌄' : '⌃'}</span></button><div className="walk-progress"><i><b style={{ width: `${progress}%` }} /></i><span>{progress}%</span></div><div className="walk-panel-details" aria-hidden={!expanded}><p>드래그로 좌우를 보고, 휠 또는 두 손가락으로 자세히 봅니다.</p><div className="move-modes">{([['stop', '멈춤'], ['walk', '걷기'], ['run', '달리기']] as const).map(([value, label]) => <button key={value} type="button" className={mode === value ? 'active' : ''} onClick={() => { setMode(value); setExpanded(false); }}><strong>{label}</strong><small>{value === 'walk' ? '가벼운 산책' : value === 'run' ? '구보' : '풍경 감상'}</small></button>)}</div></div></section>
    <p className="mvp-note">실제 3D 식생 · PBR 흙길 · 통일된 조명과 안개를 사용하는 운영 품질 장면</p><div className="asset-credit">CC0 assets · Poly Haven</div></main>;
}
