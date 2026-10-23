import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  MAX_PAINT,
  DEFAULT_TUNING,
  PAINT_ZONES,
  REQUIRED_PAINTED_ZONES,
  ROUND_SECONDS,
  TUNING_LABELS,
  TUNING_POINT_BUDGET,
  TUNING_STATS,
  ZONE_LABELS,
  addPaintedZone,
  changeTuning,
  chooseUnpaintedZone,
  hasWon,
  resolveWeaponStats,
  spentTuningPoints,
  type PaintZone,
  type WeaponTuning,
} from './gameLogic';
import { createArenaAssets, createPaintSplat, createPaintSportCharacter, type CharacterRig } from './threeAssets';
import './styles.css';

interface ColorBlastersGameProps {
  onExit?: () => void;
}

type RoundPhase = 'playing' | 'won' | 'lost' | 'draw';
type Owner = 'player' | 'ai';

interface Projectile {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  owner: Owner;
  travelled: number;
}

interface ArenaRuntime {
  restart: () => void;
  setCharging: (charging: boolean) => void;
  setMoveVector: (x: number, z: number) => void;
  dash: () => void;
}

interface HudState {
  phase: RoundPhase;
  secondsLeft: number;
  playerPaint: number;
  maxPlayerPaint: number;
  aiPaint: number;
  playerZones: PaintZone[];
  aiZones: PaintZone[];
  nearStation: boolean;
  charging: boolean;
  inCover: boolean;
  message: string;
}

const PLAYER_COLOR = 0x22d3ee;
const AI_COLOR = 0xfb7185;
const PLAYER_BASE = 0xe2e8f0;
const AI_BASE = 0xffedd5;
const MOVE_SPEED = 5.2;
const AI_FIRE_INTERVAL = 0.72;

const INITIAL_HUD: HudState = {
  phase: 'playing',
  secondsLeft: ROUND_SECONDS,
  playerPaint: MAX_PAINT,
  maxPlayerPaint: MAX_PAINT,
  aiPaint: MAX_PAINT,
  playerZones: [],
  aiZones: [],
  nearStation: false,
  charging: false,
  inCover: false,
  message: 'AI보다 먼저 4개 부위를 칠하세요!',
};

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => material.dispose());
  });
}

export function ColorBlastersGame({ onExit }: ColorBlastersGameProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<ArenaRuntime | null>(null);
  const [hud, setHud] = useState<HudState>(INITIAL_HUD);
  const [tuning, setTuning] = useState<WeaponTuning>(() => {
    try {
      const saved = localStorage.getItem('color-blasters:tuning');
      return saved ? { ...DEFAULT_TUNING, ...JSON.parse(saved) } : { ...DEFAULT_TUNING };
    } catch {
      return { ...DEFAULT_TUNING };
    }
  });
  const tuningRef = useRef(tuning);

  useEffect(() => {
    tuningRef.current = tuning;
    localStorage.setItem('color-blasters:tuning', JSON.stringify(tuning));
  }, [tuning]);

  const updateMove = useCallback((x: number, z: number) => {
    runtimeRef.current?.setMoveVector(x, z);
  }, []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x8bcfe6);
    scene.fog = new THREE.Fog(0x8bcfe6, 28, 54);

    const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 100);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xf4fbff, 0x1e293b, 2.15));
    const sun = new THREE.DirectionalLight(0xfff4dd, 3.15);
    sun.position.set(-7, 15, 9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -18;
    sun.shadow.camera.right = 18;
    sun.shadow.camera.top = 20;
    sun.shadow.camera.bottom = -20;
    scene.add(sun);
    const cyanFill = new THREE.PointLight(0x22d3ee, 18, 22, 2);
    cyanFill.position.set(-10, 5, 8);
    scene.add(cyanFill);
    const coralFill = new THREE.PointLight(0xfb7185, 16, 22, 2);
    coralFill.position.set(10, 5, -8);
    scene.add(coralFill);

    const arena = createArenaAssets();
    scene.add(arena.group);
    const coverBoxes = arena.covers;
    const station = arena.station;
    arena.group.updateMatrixWorld(true);
    const coverBounds = coverBoxes.map((cover) => new THREE.Box3().setFromObject(cover));
    const playerCollisionBounds = coverBounds.map((box) => box.clone().expandByScalar(0.55));

    const player = createPaintSportCharacter(PLAYER_BASE, PLAYER_COLOR);
    player.group.position.set(7, 0, 9.5);
    player.group.rotation.y = Math.PI;
    scene.add(player.group);

    const ai = createPaintSportCharacter(AI_BASE, AI_COLOR);
    ai.group.position.set(7, 0, -10.5);
    scene.add(ai.group);

    const playerPaintMaterial = new THREE.MeshStandardMaterial({
      color: PLAYER_COLOR,
      emissive: PLAYER_COLOR,
      emissiveIntensity: 0.22,
      roughness: 0.42,
    });
    const aiPaintMaterial = new THREE.MeshStandardMaterial({
      color: AI_COLOR,
      emissive: AI_COLOR,
      emissiveIntensity: 0.2,
      roughness: 0.42,
    });

    const clock = new THREE.Clock();
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -2.5);
    const targetPoint = new THREE.Vector3(0, 2.5, -10);
    const keys = new Set<string>();
    const projectiles: Projectile[] = [];
    const splats: Array<{ mesh: THREE.Mesh; expiresAt: number }> = [];
    let playerPaint = resolveWeaponStats(tuningRef.current).maxPaint;
    let aiPaint = MAX_PAINT;
    let playerPainted: ReadonlySet<PaintZone> = new Set();
    let aiPainted: ReadonlySet<PaintZone> = new Set();
    let phase: RoundPhase = 'playing';
    let roundStartedAt = performance.now();
    let lastPlayerShot = -10;
    let lastAiShot = -10;
    let lastHudPush = 0;
    let animationFrame = 0;
    let charging = false;
    let mobileMoveVector = new THREE.Vector2();
    let dashCooldownUntil = 0;
    let dashVelocity = new THREE.Vector3();
    const playerVelocity = new THREE.Vector3();
    let fireHeld = false;
    let nearStation = false;
    let inCover = false;

    const segmentHitsCover = (start: THREE.Vector3, end: THREE.Vector3) => {
      const direction = end.clone().sub(start);
      const distance = direction.length();
      if (distance < 0.001) return false;
      const ray = new THREE.Ray(start, direction.normalize());
      const hitPoint = new THREE.Vector3();
      return coverBounds.some((box) => ray.intersectBox(box, hitPoint) !== null && hitPoint.distanceTo(start) <= distance);
    };

    const moveAroundCovers = (object: THREE.Object3D, movement: THREE.Vector3, bounds: THREE.Box3[]) => {
      const nextX = object.position.clone();
      nextX.x += movement.x;
      if (!bounds.some((box) => box.containsPoint(new THREE.Vector3(nextX.x, 0.8, nextX.z)))) object.position.x = nextX.x;
      const nextZ = object.position.clone();
      nextZ.z += movement.z;
      if (!bounds.some((box) => box.containsPoint(new THREE.Vector3(nextZ.x, 0.8, nextZ.z)))) object.position.z = nextZ.z;
    };

    const resize = () => {
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      camera.aspect = width / Math.max(height, 1);
      camera.fov = camera.aspect < 0.75 ? 66 : 52;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };

    const pushHud = (force = false, message?: string) => {
      const now = performance.now();
      if (!force && now - lastHudPush < 80) return;
      lastHudPush = now;
      const elapsed = (now - roundStartedAt) / 1000;
      setHud((previous) => ({
        phase,
        secondsLeft: Math.max(0, Math.ceil(ROUND_SECONDS - elapsed)),
        playerPaint: Math.round(playerPaint * 10) / 10,
        maxPlayerPaint: resolveWeaponStats(tuningRef.current).maxPaint,
        aiPaint: Math.round(aiPaint * 10) / 10,
        playerZones: [...playerPainted],
        aiZones: [...aiPainted],
        nearStation,
        charging,
        inCover,
        message: message ?? previous.message,
      }));
    };

    const resetMaterials = (rig: CharacterRig) => {
      rig.group.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const zone = object.userData.paintZone as PaintZone | undefined;
        if (zone) object.material = object.userData.baseMaterial as THREE.Material;
      });
    };

    const applyZoneMaterial = (rig: CharacterRig, zone: PaintZone, material: THREE.Material) => {
      rig.group.traverse((object) => {
        if (object instanceof THREE.Mesh && object.userData.paintZone === zone) object.material = material;
      });
    };

    const clearProjectiles = () => {
      projectiles.splice(0).forEach(({ mesh }) => {
        scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      });
      splats.splice(0).forEach(({ mesh }) => {
        scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      });
    };

    const restart = () => {
      clearProjectiles();
      playerPaint = resolveWeaponStats(tuningRef.current).maxPaint;
      aiPaint = MAX_PAINT;
      playerPainted = new Set();
      aiPainted = new Set();
      phase = 'playing';
      roundStartedAt = performance.now();
      lastPlayerShot = -10;
      lastAiShot = -10;
      charging = false;
      fireHeld = false;
      playerVelocity.set(0, 0, 0);
      dashVelocity.set(0, 0, 0);
      player.group.position.set(7, 0, 9.5);
      player.group.rotation.set(0, Math.PI, 0);
      ai.group.position.set(7, 0, -10.5);
      resetMaterials(player);
      resetMaterials(ai);
      pushHud(true, 'AI보다 먼저 4개 부위를 칠하세요!');
    };

    const createSplat = (position: THREE.Vector3, color: number) => {
      const mesh = createPaintSplat(color);
      mesh.position.copy(position);
      mesh.lookAt(camera.position);
      scene.add(mesh);
      splats.push({ mesh, expiresAt: performance.now() + 280 });
    };

    const paintZone = (owner: Owner, zone: PaintZone, hitPosition: THREE.Vector3) => {
      if (owner === 'player') {
        const next = addPaintedZone(aiPainted, zone);
        const isNew = next !== aiPainted;
        aiPainted = next;
        applyZoneMaterial(ai, zone, playerPaintMaterial);
        createSplat(hitPosition, PLAYER_COLOR);
        if (isNew) pushHud(true, `${ZONE_LABELS[zone]} 도색 성공!`);
        if (hasWon(aiPainted)) {
          phase = 'won';
          pushHud(true, '페인트 아웃! 플레이어 승리!');
        }
      } else {
        const next = addPaintedZone(playerPainted, zone);
        const isNew = next !== playerPainted;
        playerPainted = next;
        applyZoneMaterial(player, zone, aiPaintMaterial);
        createSplat(hitPosition, AI_COLOR);
        if (isNew) pushHud(true, `AI가 ${ZONE_LABELS[zone]}을 칠했습니다!`);
        if (hasWon(playerPainted)) {
          phase = 'lost';
          pushHud(true, '페인트 아웃! AI 승리');
        }
      }
    };

    const spawnProjectile = (owner: Owner, origin: THREE.Vector3, target: THREE.Vector3) => {
      const color = owner === 'player' ? PLAYER_COLOR : AI_COLOR;
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.16, 10, 8),
        new THREE.MeshBasicMaterial({ color }),
      );
      mesh.position.copy(origin);
      scene.add(mesh);
      const direction = target.clone().sub(origin).normalize();
      const weaponStats = resolveWeaponStats(tuningRef.current);
      const spread = owner === 'player' ? weaponStats.spread : 0.045;
      direction.x += (Math.random() - 0.5) * spread;
      direction.y += (Math.random() - 0.5) * spread;
      direction.z += (Math.random() - 0.5) * spread;
      direction.normalize();
      projectiles.push({
        mesh,
        velocity: direction.multiplyScalar(owner === 'player' ? weaponStats.projectileSpeed : 20),
        owner,
        travelled: 0,
      });
    };

    const playerShoot = (elapsed: number) => {
      const weaponStats = resolveWeaponStats(tuningRef.current);
      if (phase !== 'playing' || charging || playerPaint < 1 || elapsed - lastPlayerShot < weaponStats.fireInterval) return;
      lastPlayerShot = elapsed;
      playerPaint -= 1;
      player.group.updateMatrixWorld(true);
      const origin = player.group.localToWorld(new THREE.Vector3(0.7, 2.9, 1.05));
      spawnProjectile('player', origin, targetPoint);
      pushHud(true, playerPaint <= 0 ? '페인트가 비었습니다. 충전소로 이동하세요!' : undefined);
    };

    const setPointerTarget = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const targetMeshes = [...ai.zones.values()];
      const hit = raycaster.intersectObjects(targetMeshes, false)[0];
      if (hit) {
        targetPoint.copy(hit.point);
        return;
      }
      const planePoint = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(aimPlane, planePoint)) targetPoint.copy(planePoint);
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      setPointerTarget(event);
      fireHeld = true;
      playerShoot(clock.elapsedTime);
    };
    const handlePointerMove = (event: PointerEvent) => setPointerTarget(event);
    const handlePointerUp = () => { fireHeld = false; };
    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    const onKeyDown = (event: KeyboardEvent) => {
      keys.add(event.code);
      if (event.code === 'KeyE') charging = true;
      if (event.code === 'Space') {
        event.preventDefault();
        if (performance.now() >= dashCooldownUntil) {
          const x = Number(keys.has('KeyD')) - Number(keys.has('KeyA'));
          const z = Number(keys.has('KeyS')) - Number(keys.has('KeyW'));
          dashVelocity.set(x || 0, 0, z || -1).normalize().multiplyScalar(12);
          dashCooldownUntil = performance.now() + 1250;
        }
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      keys.delete(event.code);
      if (event.code === 'KeyE') charging = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('resize', resize);
    resize();

    runtimeRef.current = {
      restart,
      setCharging(value) { charging = value; pushHud(true); },
      setMoveVector(x, z) { mobileMoveVector.set(x, z); },
      dash() {
        if (performance.now() < dashCooldownUntil) return;
        const direction = mobileMoveVector.lengthSq() > 0
          ? new THREE.Vector3(mobileMoveVector.x, 0, mobileMoveVector.y).normalize()
          : new THREE.Vector3(0, 0, -1);
        dashVelocity.copy(direction.multiplyScalar(12));
        dashCooldownUntil = performance.now() + 1250;
      },
    };

    const updatePlayer = (delta: number) => {
      const keyboardX = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'));
      const keyboardZ = Number(keys.has('KeyS') || keys.has('ArrowDown')) - Number(keys.has('KeyW') || keys.has('ArrowUp'));
      const movement = new THREE.Vector3(
        keyboardX + mobileMoveVector.x,
        0,
        keyboardZ + mobileMoveVector.y,
      );
      if (movement.lengthSq() > 1) movement.normalize();
      const desiredVelocity = movement.clone().multiplyScalar(MOVE_SPEED);
      playerVelocity.lerp(desiredVelocity, 1 - Math.exp(-delta * (movement.lengthSq() > 0 ? 12 : 8)));
      const previousPosition = player.group.position.clone();
      const frameMovement = playerVelocity.clone().add(dashVelocity).multiplyScalar(delta);
      moveAroundCovers(player.group, frameMovement, playerCollisionBounds);
      dashVelocity.multiplyScalar(Math.pow(0.03, delta));
      player.group.position.x = THREE.MathUtils.clamp(player.group.position.x, -10.5, 10.5);
      player.group.position.z = THREE.MathUtils.clamp(player.group.position.z, -13.5, 13.5);
      const playerPoint = new THREE.Vector3(player.group.position.x, 0.8, player.group.position.z);
      if (playerCollisionBounds.some((box) => box.containsPoint(playerPoint))) {
        player.group.position.x = previousPosition.x;
        player.group.position.z = previousPosition.z;
        playerVelocity.multiplyScalar(0.15);
      }
      const desiredYaw = Math.atan2(targetPoint.x - player.group.position.x, targetPoint.z - player.group.position.z);
      const yawDelta = Math.atan2(Math.sin(desiredYaw - player.group.rotation.y), Math.cos(desiredYaw - player.group.rotation.y));
      player.group.rotation.y += yawDelta * Math.min(1, delta * 12);
      player.group.userData.moveAmount = Math.min(1, playerVelocity.length() / MOVE_SPEED);
      nearStation = player.group.position.distanceTo(station.position) < 2.15;
      const maxPlayerPaint = resolveWeaponStats(tuningRef.current).maxPaint;
      if (charging && nearStation && playerPaint < maxPlayerPaint) {
        playerPaint = Math.min(maxPlayerPaint, playerPaint + delta * 7.5);
      }
      if (charging && !nearStation) charging = false;
      inCover = segmentHitsCover(
        ai.group.position.clone().add(new THREE.Vector3(0, 2.8, 0)),
        player.group.position.clone().add(new THREE.Vector3(0, 2.8, 0)),
      );
    };

    const updateAi = (elapsed: number, delta: number) => {
      if (aiPaint <= 0) {
        const toStation = station.position.clone().sub(ai.group.position).setY(0);
        if (toStation.length() > 1.8) ai.group.position.addScaledVector(toStation.normalize(), 3.1 * delta);
        else aiPaint = Math.min(MAX_PAINT, aiPaint + delta * 6.2);
        return;
      }
      const desiredX = Math.sin(elapsed * 0.72) * 6.6;
      const desiredZ = -8.5 + Math.sin(elapsed * 0.43) * 2.1;
      moveAroundCovers(ai.group, new THREE.Vector3(
        (desiredX - ai.group.position.x) * Math.min(1, delta * 1.35),
        0,
        (desiredZ - ai.group.position.z) * Math.min(1, delta * 1.2),
      ), playerCollisionBounds);
      ai.group.rotation.y = Math.atan2(
        player.group.position.x - ai.group.position.x,
        player.group.position.z - ai.group.position.z,
      );
      const aiOrigin = ai.group.position.clone().add(new THREE.Vector3(0.7, 2.9, 1.05).applyAxisAngle(new THREE.Vector3(0, 1, 0), ai.group.rotation.y));
      const playerTorso = player.group.position.clone().add(new THREE.Vector3(0, 2.72, 0));
      if (elapsed - lastAiShot >= AI_FIRE_INTERVAL && !segmentHitsCover(aiOrigin, playerTorso)) {
        lastAiShot = elapsed;
        aiPaint -= 1;
        const zone = chooseUnpaintedZone(playerPainted);
        const targetMesh = player.zones.get(zone)!;
        const target = new THREE.Vector3();
        targetMesh.getWorldPosition(target);
        target.x += (Math.random() - 0.5) * 0.7;
        target.y += (Math.random() - 0.5) * 0.45;
        ai.group.updateMatrixWorld(true);
        const origin = ai.group.localToWorld(new THREE.Vector3(0.7, 2.9, 1.05));
        spawnProjectile('ai', origin, target);
      }
    };

    const updateProjectiles = (delta: number) => {
      const now = performance.now();
      const segment = new THREE.Line3();
      const closestPoint = new THREE.Vector3();
      for (let index = projectiles.length - 1; index >= 0; index -= 1) {
        const projectile = projectiles[index]!;
        const previousPosition = projectile.mesh.position.clone();
        const step = projectile.velocity.clone().multiplyScalar(delta);
        projectile.mesh.position.add(step);
        projectile.travelled += step.length();
        segment.set(previousPosition, projectile.mesh.position);
        const opponent = projectile.owner === 'player' ? ai : player;
        let hit = false;
        for (const [zone, mesh] of opponent.zones) {
          const center = new THREE.Vector3();
          mesh.getWorldPosition(center);
          const radius = zone === 'torso' ? 0.92 : zone === 'head' ? 0.68 : 0.52;
          segment.closestPointToPoint(center, true, closestPoint);
          if (closestPoint.distanceToSquared(center) <= radius * radius) {
            paintZone(projectile.owner, zone, closestPoint.clone());
            hit = true;
            break;
          }
        }
        if (!hit) {
          const shotDirection = projectile.mesh.position.clone().sub(previousPosition);
          const shotDistance = shotDirection.length();
          const shotRay = new THREE.Ray(previousPosition, shotDirection.normalize());
          const coverHit = new THREE.Vector3();
          for (const box of coverBounds) {
            if (shotRay.intersectBox(box, coverHit) && coverHit.distanceTo(previousPosition) <= shotDistance) {
              createSplat(coverHit.clone(), projectile.owner === 'player' ? PLAYER_COLOR : AI_COLOR);
              hit = true;
              break;
            }
          }
        }
        if (hit || projectile.travelled > 45) {
          scene.remove(projectile.mesh);
          projectile.mesh.geometry.dispose();
          (projectile.mesh.material as THREE.Material).dispose();
          projectiles.splice(index, 1);
        }
      }
      for (let index = splats.length - 1; index >= 0; index -= 1) {
        const splat = splats[index]!;
        const life = Math.max(0, (splat.expiresAt - now) / 280);
        (splat.mesh.material as THREE.MeshBasicMaterial).opacity = life;
        splat.mesh.scale.setScalar(1 + (1 - life) * 1.8);
        if (now >= splat.expiresAt) {
          scene.remove(splat.mesh);
          splat.mesh.geometry.dispose();
          (splat.mesh.material as THREE.Material).dispose();
          splats.splice(index, 1);
        }
      }
    };

    const updateCamera = (delta: number) => {
      const portrait = camera.aspect < 0.75;
      const desired = player.group.position.clone().add(portrait
        ? new THREE.Vector3(1.8, 6.3, 5.8)
        : new THREE.Vector3(4.8, 8.2, 14.5));
      camera.position.lerp(desired, Math.min(1, delta * 5));
      camera.lookAt(player.group.position.clone().add(new THREE.Vector3(0, portrait ? 2.25 : 2.5, portrait ? -6.5 : -5.8)));
    };

    const updateAssetAnimation = (elapsed: number) => {
      arena.animatedGlow.rotation.z = elapsed * 1.8;
      const pulse = 1 + Math.sin(elapsed * 4.5) * 0.06;
      arena.animatedGlow.scale.setScalar(pulse);
      const playerBlaster = player.group.userData.blaster as THREE.Group;
      const aiBlaster = ai.group.userData.blaster as THREE.Group;
      playerBlaster.rotation.x = elapsed - lastPlayerShot < 0.09 ? -0.14 : 0;
      aiBlaster.rotation.x = elapsed - lastAiShot < 0.09 ? -0.14 : 0;
      const moveAmount = Number(player.group.userData.moveAmount ?? 0);
      const stride = Math.sin(elapsed * 10.5) * 0.38 * moveAmount;
      const playerLeftArm = player.group.userData.leftArm as THREE.Group;
      const playerRightArm = player.group.userData.rightArm as THREE.Group;
      const playerLeftLeg = player.group.userData.leftLeg as THREE.Group;
      const playerRightLeg = player.group.userData.rightLeg as THREE.Group;
      playerLeftArm.rotation.set(stride * 0.6, 0, -0.12);
      playerRightArm.rotation.set(-stride * 0.35, 0, 0.12);
      playerLeftLeg.rotation.x = -stride;
      playerRightLeg.rotation.x = stride;
      const aiStride = Math.sin(elapsed * 8) * 0.24;
      (ai.group.userData.leftLeg as THREE.Group).rotation.x = -aiStride;
      (ai.group.userData.rightLeg as THREE.Group).rotation.x = aiStride;
    };

    const animate = () => {
      animationFrame = requestAnimationFrame(animate);
      const delta = Math.min(clock.getDelta(), 0.05);
      const elapsed = clock.elapsedTime;
      if (phase === 'playing') {
        updatePlayer(delta);
        updateAi(elapsed, delta);
        if (fireHeld) playerShoot(elapsed);
        updateProjectiles(delta);
        const roundElapsed = (performance.now() - roundStartedAt) / 1000;
        if (roundElapsed >= ROUND_SECONDS) {
          phase = aiPainted.size > playerPainted.size ? 'won' : aiPainted.size < playerPainted.size ? 'lost' : 'draw';
          pushHud(true, phase === 'draw' ? '무승부! 다시 도전하세요.' : phase === 'won' ? '시간 종료! 플레이어 승리' : '시간 종료! AI 승리');
        }
      } else {
        updateProjectiles(delta);
      }
      updateAssetAnimation(elapsed);
      updateCamera(delta);
      pushHud();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animationFrame);
      runtimeRef.current = null;
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('resize', resize);
      clearProjectiles();
      disposeObject(scene);
      playerPaintMaterial.dispose();
      aiPaintMaterial.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  const phaseTitle = hud.phase === 'won'
    ? '플레이어 승리!'
    : hud.phase === 'lost'
      ? 'AI 승리'
      : hud.phase === 'draw'
        ? '무승부'
        : '';
  const spentPoints = spentTuningPoints(tuning);

  return (
    <main className="cb-game">
      <div ref={mountRef} className="cb-canvas" aria-label="컬러 블래스터즈 3D 경기장" />

      <header className="cb-topbar">
        <button type="button" className="cb-exit" onClick={onExit}>← 허브</button>
        <div className="cb-title-block">
          <strong>컬러 블래스터즈</strong>
          <span>페인트 러시 · 먼저 {REQUIRED_PAINTED_ZONES}곳 도색</span>
        </div>
        <div className="cb-timer">{String(Math.floor(hud.secondsLeft / 60)).padStart(2, '0')}:{String(hud.secondsLeft % 60).padStart(2, '0')}</div>
      </header>

      <section className="cb-score cb-score-player" aria-label="플레이어 상태">
        <strong>나</strong>
        <div className="cb-zone-row">
          {PAINT_ZONES.map((zone) => (
            <span key={zone} className={hud.playerZones.includes(zone) ? 'painted' : ''} title={ZONE_LABELS[zone]}>{ZONE_LABELS[zone][0]}</span>
          ))}
        </div>
        <b>{hud.playerZones.length}/6</b>
      </section>

      <section className="cb-score cb-score-ai" aria-label="AI 상태">
        <strong>AI</strong>
        <div className="cb-zone-row">
          {PAINT_ZONES.map((zone) => (
            <span key={zone} className={hud.aiZones.includes(zone) ? 'painted' : ''} title={ZONE_LABELS[zone]}>{ZONE_LABELS[zone][0]}</span>
          ))}
        </div>
        <b>{hud.aiZones.length}/6</b>
      </section>

      <div className="cb-message">{hud.message}</div>
      <div className={`cb-cover-status ${hud.inCover ? 'active' : ''}`} aria-live="polite">
        {hud.inCover ? '방벽 엄폐 중 · AI 탄도 차단' : '방벽 뒤로 이동하면 엄폐'}
      </div>

      <section className="cb-ammo" aria-label="페인트 잔량">
        <span>페인트</span>
        <strong>{Math.ceil(hud.playerPaint)}/{hud.maxPlayerPaint}</strong>
        <div><i style={{ width: `${(hud.playerPaint / hud.maxPlayerPaint) * 100}%` }} /></div>
      </section>

      <aside className="cb-help">
        <span>WASD 이동</span>
        <span>마우스 조준·발사</span>
        <span>Space 회피</span>
        <span>방벽 뒤 엄폐</span>
        <span>E 충전</span>
      </aside>

      <div className="cb-mobile-pad" aria-label="모바일 이동 버튼">
        <button type="button" onPointerDown={() => updateMove(0, -1)} onPointerUp={() => updateMove(0, 0)} onPointerCancel={() => updateMove(0, 0)}>▲</button>
        <button type="button" onPointerDown={() => updateMove(-1, 0)} onPointerUp={() => updateMove(0, 0)} onPointerCancel={() => updateMove(0, 0)}>◀</button>
        <button type="button" onPointerDown={() => updateMove(1, 0)} onPointerUp={() => updateMove(0, 0)} onPointerCancel={() => updateMove(0, 0)}>▶</button>
        <button type="button" onPointerDown={() => updateMove(0, 1)} onPointerUp={() => updateMove(0, 0)} onPointerCancel={() => updateMove(0, 0)}>▼</button>
      </div>
      <div className="cb-actions" aria-label="모바일 액션 버튼">
        <button type="button" className="cb-dash" onClick={() => runtimeRef.current?.dash()}>
          <span aria-hidden="true">↯</span>
          회피
        </button>
        <button
          type="button"
          className={`cb-charge ${hud.charging ? 'active' : ''}`}
          disabled={!hud.nearStation}
          onPointerDown={() => runtimeRef.current?.setCharging(true)}
          onPointerUp={() => runtimeRef.current?.setCharging(false)}
          onPointerLeave={() => runtimeRef.current?.setCharging(false)}
          onPointerCancel={() => runtimeRef.current?.setCharging(false)}
        >
          <span aria-hidden="true">◉</span>
          {hud.charging ? '충전 중…' : hud.nearStation ? '페인트 충전' : '충전소 필요'}
        </button>
      </div>

      {hud.phase !== 'playing' && (
        <section className="cb-result" role="dialog" aria-modal="true">
          <p>페인트 러시 결과</p>
          <h2>{phaseTitle}</h2>
          <div className="cb-result-score">
            <span>나 {hud.aiZones.length}/6</span>
            <b>:</b>
            <span>AI {hud.playerZones.length}/6</span>
          </div>
          <div className="cb-tuning">
            <div className="cb-tuning-title">
              <strong>블래스터 튜닝</strong>
              <span>{spentPoints}/{TUNING_POINT_BUDGET} 포인트</span>
            </div>
            {TUNING_STATS.map((stat) => (
              <div className="cb-tuning-row" key={stat}>
                <span>{TUNING_LABELS[stat]}</span>
                <button type="button" aria-label={`${TUNING_LABELS[stat]} 감소`} onClick={() => setTuning((current) => changeTuning(current, stat, -1))}>−</button>
                <b>{tuning[stat]}</b>
                <button type="button" aria-label={`${TUNING_LABELS[stat]} 증가`} onClick={() => setTuning((current) => changeTuning(current, stat, 1))}>＋</button>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => runtimeRef.current?.restart()}>튜닝 적용 후 다시 하기</button>
        </section>
      )}
    </main>
  );
}
