import * as THREE from 'three';
import type { PaintZone } from './gameLogic';

export interface CharacterRig {
  group: THREE.Group;
  zones: Map<PaintZone, THREE.Mesh>;
  baseMaterials: Map<PaintZone, THREE.MeshStandardMaterial>;
}

const physical = (color: number, metalness = 0.05, roughness = 0.5) => new THREE.MeshStandardMaterial({ color, metalness, roughness });

function shadow(mesh: THREE.Mesh) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function markPaintPart<T extends THREE.Mesh>(mesh: T, zone: PaintZone) {
  mesh.userData.paintZone = zone;
  mesh.userData.baseMaterial = mesh.material;
  return mesh;
}

export function createPaintSportCharacter(baseColor: number, teamColor: number): CharacterRig {
  const group = new THREE.Group();
  const zones = new Map<PaintZone, THREE.Mesh>();
  const baseMaterials = new Map<PaintZone, THREE.MeshStandardMaterial>();
  const navy = physical(0x172554, 0.18, 0.3);
  const team = physical(teamColor, 0.12, 0.34);
  const white = physical(baseColor, 0.02, 0.58);
  const dark = physical(0x111827, 0.3, 0.25);
  const glow = new THREE.MeshStandardMaterial({ color: teamColor, emissive: teamColor, emissiveIntensity: 0.65, roughness: 0.28 });

  const zone = (name: PaintZone, geometry: THREE.BufferGeometry, position: [number, number, number], material = white) => {
    const ownMaterial = material.clone();
    const mesh = shadow(new THREE.Mesh(geometry, ownMaterial));
    mesh.position.set(...position);
    mesh.userData.paintZone = name;
    mesh.userData.baseMaterial = ownMaterial;
    group.add(mesh);
    zones.set(name, mesh);
    baseMaterials.set(name, ownMaterial);
    return mesh;
  };

  const torso = zone('torso', new THREE.CapsuleGeometry(0.67, 0.78, 8, 20), [0, 2.72, 0]);
  torso.scale.set(1.08, 1.08, 0.66);
  const head = zone('head', new THREE.SphereGeometry(0.58, 28, 20), [0, 4.04, 0], team);
  head.scale.set(0.96, 1.05, 0.98);
  const leftArm = zone('leftArm', new THREE.CapsuleGeometry(0.22, 0.94, 7, 14), [-0.91, 2.72, 0], white);
  const rightArm = zone('rightArm', new THREE.CapsuleGeometry(0.22, 0.94, 7, 14), [0.91, 2.72, 0], white);
  leftArm.rotation.z = -0.12;
  rightArm.rotation.z = 0.12;
  const leftLeg = zone('leftLeg', new THREE.CapsuleGeometry(0.27, 1.02, 7, 14), [-0.36, 1.02, 0], navy);
  const rightLeg = zone('rightLeg', new THREE.CapsuleGeometry(0.27, 1.02, 7, 14), [0.36, 1.02, 0], navy);

  const joint = (mesh: THREE.Mesh, origin: [number, number, number]) => {
    const pivot = new THREE.Group();
    pivot.position.set(...origin);
    group.remove(mesh);
    mesh.position.sub(pivot.position);
    pivot.add(mesh);
    group.add(pivot);
    return pivot;
  };
  const leftArmPivot = joint(leftArm, [-0.91, 3.34, 0]);
  const rightArmPivot = joint(rightArm, [0.91, 3.34, 0]);
  const leftLegPivot = joint(leftLeg, [-0.36, 1.82, 0]);
  const rightLegPivot = joint(rightLeg, [0.36, 1.82, 0]);

  const neck = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.28, 16), dark));
  neck.position.set(0, 3.58, 0);
  group.add(neck);

  const waist = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.56, 0.42, 18), navy));
  waist.position.set(0, 1.92, 0);
  waist.scale.z = 0.72;
  group.add(waist);
  const belt = shadow(new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.07, 8, 24), dark));
  belt.rotation.x = Math.PI / 2;
  belt.scale.z = 0.72;
  belt.position.set(0, 2.08, 0);
  group.add(belt);

  const visor = shadow(new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 12, 0, Math.PI * 2, 0.45, 1.15), dark));
  visor.scale.set(1, 0.62, 0.42);
  visor.position.set(0, 4.08, 0.49);
  visor.rotation.x = 0.18;
  group.add(visor);
  const visorGlow = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.08, 0.05), glow);
  visorGlow.position.set(0, 4.08, 0.69);
  group.add(visorGlow);

  const helmetRim = markPaintPart(shadow(new THREE.Mesh(new THREE.TorusGeometry(0.49, 0.075, 8, 28), dark)), 'head');
  helmetRim.rotation.x = Math.PI / 2;
  helmetRim.position.set(0, 3.9, 0.02);
  group.add(helmetRim);
  for (const x of [-0.53, 0.53]) {
    const earGuard = markPaintPart(shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.12, 16), team)), 'head');
    earGuard.rotation.z = Math.PI / 2;
    earGuard.position.set(x, 4.01, 0);
    group.add(earGuard);
  }

  const chestPlate = markPaintPart(shadow(new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.58, 0.18), team)), 'torso');
  chestPlate.position.set(0, 2.78, 0.52);
  chestPlate.rotation.x = -0.08;
  group.add(chestPlate);
  const emblem = new THREE.Mesh(new THREE.OctahedronGeometry(0.16), glow);
  emblem.position.set(0, 2.8, 0.64);
  group.add(emblem);

  const chestUnderlay = markPaintPart(shadow(new THREE.Mesh(new THREE.BoxGeometry(1.18, 1.18, 0.12), navy)), 'torso');
  chestUnderlay.position.set(0, 2.7, 0.43);
  chestUnderlay.rotation.x = -0.06;
  group.add(chestUnderlay);
  chestPlate.position.z = 0.55;
  emblem.position.z = 0.68;

  for (const x of [-0.98, 0.98]) {
    const armZone: PaintZone = x < 0 ? 'leftArm' : 'rightArm';
    const shoulder = markPaintPart(shadow(new THREE.Mesh(new THREE.SphereGeometry(0.36, 16, 12), team)), armZone);
    shoulder.scale.y = 0.72;
    shoulder.position.set(x < 0 ? -0.07 : 0.07, -0.04, 0);
    (x < 0 ? leftArmPivot : rightArmPivot).add(shoulder);
  }
  for (const x of [-0.91, 0.91]) {
    const armZone: PaintZone = x < 0 ? 'leftArm' : 'rightArm';
    const glove = markPaintPart(shadow(new THREE.Mesh(new THREE.SphereGeometry(0.28, 14, 10), dark)), armZone);
    glove.scale.set(0.86, 1.08, 0.9);
    glove.position.set(0, -1.38, 0.02);
    (x < 0 ? leftArmPivot : rightArmPivot).add(glove);
  }
  for (const x of [-0.36, 0.36]) {
    const legZone: PaintZone = x < 0 ? 'leftLeg' : 'rightLeg';
    const knee = markPaintPart(shadow(new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10), team)), legZone);
    knee.scale.set(0.9, 0.72, 0.48);
    knee.position.set(0, -0.77, 0.27);
    (x < 0 ? leftLegPivot : rightLegPivot).add(knee);
  }
  for (const x of [-0.42, 0.42]) {
    const legZone: PaintZone = x < 0 ? 'leftLeg' : 'rightLeg';
    const boot = markPaintPart(shadow(new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.34, 0.9), team)), legZone);
    boot.position.set(x < 0 ? -0.06 : 0.06, -1.6, 0.18);
    (x < 0 ? leftLegPivot : rightLegPivot).add(boot);
  }

  const tank = shadow(new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.72, 8, 16), team));
  tank.position.set(0, 2.8, -0.55);
  group.add(tank);
  const harness = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.92, 1.2, 0.12), dark));
  harness.position.set(0, 2.78, -0.43);
  group.add(harness);
  tank.position.z = -0.62;
  const hoseCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.18, 3.05, -0.58), new THREE.Vector3(0.62, 3.2, -0.38), new THREE.Vector3(0.73, 2.85, 0.2),
  ]);
  group.add(new THREE.Mesh(new THREE.TubeGeometry(hoseCurve, 18, 0.045, 8, false), dark));

  const blaster = new THREE.Group();
  const body = shadow(new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.72, 6, 12), team));
  body.rotation.x = Math.PI / 2;
  blaster.add(body);
  const barrel = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 0.72, 16), navy));
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = 0.68;
  blaster.add(barrel);
  const muzzle = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.07, 8, 18), glow);
  muzzle.position.z = 1.05;
  blaster.add(muzzle);
  const hopper = shadow(new THREE.Mesh(new THREE.SphereGeometry(0.3, 18, 14), glow));
  hopper.position.set(0, 0.3, 0.12);
  blaster.add(hopper);
  const grip = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.52, 0.22), dark));
  grip.position.set(0, -0.35, 0.2);
  grip.rotation.x = -0.22;
  blaster.add(grip);
  blaster.position.set(0.72, 2.76, 0.66);
  group.add(blaster);

  group.userData.blaster = blaster;
  group.userData.leftArm = leftArmPivot;
  group.userData.rightArm = rightArmPivot;
  group.userData.leftLeg = leftLegPivot;
  group.userData.rightLeg = rightLegPivot;
  return { group, zones, baseMaterials };
}

function makeArenaTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const context = canvas.getContext('2d')!;
  const gradient = context.createLinearGradient(0, 0, 0, 1024);
  gradient.addColorStop(0, '#513968');
  gradient.addColorStop(0.48, '#173d5c');
  gradient.addColorStop(0.52, '#173d5c');
  gradient.addColorStop(1, '#126674');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 1024, 1024);
  context.strokeStyle = 'rgba(255,255,255,.5)';
  context.lineWidth = 12;
  context.strokeRect(34, 24, 956, 976);
  context.beginPath(); context.moveTo(0, 512); context.lineTo(1024, 512); context.stroke();
  context.beginPath(); context.arc(512, 512, 145, 0, Math.PI * 2); context.stroke();
  for (let index = 0; index < 24; index += 1) {
    const x = (index * 193) % 1024;
    const y = (index * 317) % 1024;
    context.fillStyle = index % 2 ? 'rgba(34,211,238,.22)' : 'rgba(251,113,133,.2)';
    context.beginPath(); context.arc(x, y, 18 + (index % 5) * 8, 0, Math.PI * 2); context.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function arenaBarrier(width: number, color: number, variant: 0 | 1 | 2) {
  const group = new THREE.Group();
  const frame = physical(0x172554, 0.45, 0.28);
  const panel = physical(color, 0.18, 0.42);
  const concrete = physical(0x64748b, 0.02, 0.86);
  const base = shadow(new THREE.Mesh(new THREE.BoxGeometry(width + 0.7, 0.32, 1.55), concrete));
  base.position.y = 0.16;
  group.add(base);
  let bodyGeometry: THREE.BufferGeometry = new THREE.BoxGeometry(width, 2.42, 0.72, 2, 2, 1);
  if (variant !== 0) {
    const outline = new THREE.Shape();
    const half = width / 2;
    if (variant === 1) {
      outline.moveTo(-half, -1.12);
      outline.lineTo(-half, 0.62);
      outline.lineTo(-half + 0.42, 1.18);
      outline.lineTo(half - 0.42, 1.18);
      outline.lineTo(half, 0.62);
      outline.lineTo(half, -1.12);
    } else {
      outline.moveTo(-half, -1.12);
      outline.lineTo(-half + 0.38, 1.18);
      outline.lineTo(half - 0.38, 1.18);
      outline.lineTo(half, -1.12);
    }
    outline.closePath();
    bodyGeometry = new THREE.ExtrudeGeometry(outline, { depth: 0.72, bevelEnabled: true, bevelSize: 0.07, bevelThickness: 0.07, bevelSegments: 2 });
    bodyGeometry.translate(0, 0, -0.36);
  }
  const body = shadow(new THREE.Mesh(bodyGeometry, panel));
  body.position.y = 1.56;
  group.add(body);
  const cap = shadow(new THREE.Mesh(new THREE.BoxGeometry(width + 0.22, 0.24, 0.9), frame));
  cap.position.y = 2.9;
  group.add(cap);
  const stripeMaterial = physical(0xfde047, 0.08, 0.3);
  for (const x of [-width * 0.32, width * 0.32]) {
    const brace = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.48, 0.82), stripeMaterial));
    brace.position.set(x, 1.56, 0.02);
    group.add(brace);
  }
  for (const x of [-width / 2 + 0.18, width / 2 - 0.18]) {
    const foot = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.22, 1.92), frame));
    foot.position.set(x, 0.35, 0);
    group.add(foot);
    const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.08, 10), stripeMaterial);
    bolt.position.set(x, 0.21, 0.62);
    group.add(bolt);
  }
  const inset = new THREE.Mesh(new THREE.BoxGeometry(width * 0.42, 0.42, 0.06), frame);
  inset.position.set(0, 1.62, 0.49);
  group.add(inset);
  const innerPanel = shadow(new THREE.Mesh(new THREE.BoxGeometry(width * 0.34, 0.88, 0.06), physical(0x0f172a, 0.24, 0.34)));
  innerPanel.position.set(0, 1.62, 0.4);
  group.add(innerPanel);
  if (variant === 1) {
    const viewport = shadow(new THREE.Mesh(new THREE.BoxGeometry(width * 0.42, 0.34, 0.12), physical(0xbae6fd, 0.48, 0.16)));
    viewport.position.set(0, 2.2, 0.43);
    group.add(viewport);
  }
  if (variant === 2) {
    for (const x of [-width * 0.24, width * 0.24]) {
      const bumper = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 2.1, 12), stripeMaterial));
      bumper.position.set(x, 1.55, 0.48);
      group.add(bumper);
    }
  }
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.045, 8, 18, Math.PI), frame);
  handle.position.set(0, 2.24, 0.48);
  handle.rotation.z = Math.PI;
  group.add(handle);
  for (const x of [-width * 0.42, width * 0.42]) {
    const support = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.62, 1.35), frame));
    support.position.set(x, 0.98, 0);
    support.rotation.z = x < 0 ? -0.18 : 0.18;
    group.add(support);
  }
  return group;
}

export function createArenaAssets() {
  const group = new THREE.Group();
  const floor = shadow(new THREE.Mesh(
    new THREE.PlaneGeometry(24, 32),
    new THREE.MeshStandardMaterial({ map: makeArenaTexture(), roughness: 0.72, metalness: 0.03 }),
  ));
  floor.rotation.x = -Math.PI / 2;
  group.add(floor);

  const railMaterial = physical(0x172554, 0.18, 0.34);
  const glowMaterial = new THREE.MeshStandardMaterial({ color: 0x67e8f9, emissive: 0x22d3ee, emissiveIntensity: 0.55 });
  for (const x of [-12, 12]) {
    const rail = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.65, 2.2, 32), railMaterial));
    rail.position.set(x, 1.1, 0);
    group.add(rail);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 31), glowMaterial);
    strip.position.set(x, 2.15, 0);
    group.add(strip);
  }
  for (const z of [-16, 16]) {
    const rail = shadow(new THREE.Mesh(new THREE.BoxGeometry(24, 2.2, 0.65), railMaterial));
    rail.position.set(0, 1.1, z);
    group.add(rail);
  }

  const covers: THREE.Object3D[] = [];
  const coverData: Array<[number, number, number, number, 0 | 1 | 2]> = [
    [-4.4, -1.5, 2.8, 0x22d3ee, 1], [4.4, 1.5, 2.8, 0xfb7185, 2], [0, -6.2, 4.4, 0xf97316, 0], [0, 6.2, 4.4, 0xfde047, 1],
  ];
  for (const [x, z, width, color, variant] of coverData) {
    const cover = arenaBarrier(width, color, variant);
    cover.position.set(x, 0, z);
    if (Math.abs(x) > 1) cover.rotation.y = Math.PI / 2;
    group.add(cover);
    covers.push(cover);
  }

  const station = new THREE.Group();
  const pad = shadow(new THREE.Mesh(new THREE.CylinderGeometry(1.65, 1.65, 0.2, 32), physical(0x172554, 0.35, 0.28)));
  pad.position.y = 0.1;
  station.add(pad);
  const padGlow = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.12, 10, 32), glowMaterial.clone());
  padGlow.rotation.x = Math.PI / 2;
  padGlow.position.y = 0.23;
  station.add(padGlow);
  const column = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.68, 2.25, 20), physical(0xffffff, 0.18, 0.35)));
  column.position.y = 1.3;
  station.add(column);
  const tank = shadow(new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 0.78, 8, 16), new THREE.MeshPhysicalMaterial({ color: 0xfde047, emissive: 0xf59e0b, emissiveIntensity: 0.35, transmission: 0.18, roughness: 0.2 })));
  tank.position.y = 1.55;
  station.add(tank);
  const crown = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.12, 10, 24), physical(0xfb7185, 0.15, 0.28));
  crown.rotation.x = Math.PI / 2;
  crown.position.y = 2.5;
  station.add(crown);
  station.position.set(-8.2, 0, 1.5);
  group.add(station);

  return { group, floor, covers, station, animatedGlow: padGlow };
}

export function createPaintSplat(color: number) {
  const shape = new THREE.Shape();
  const points = 18;
  for (let index = 0; index <= points; index += 1) {
    const angle = (index / points) * Math.PI * 2;
    const radius = index % 3 === 0 ? 0.38 : index % 2 === 0 ? 0.25 : 0.3;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (index === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  return new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.92, side: THREE.DoubleSide }),
  );
}
