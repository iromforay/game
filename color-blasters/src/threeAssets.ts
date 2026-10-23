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
    group.add(mesh);
    zones.set(name, mesh);
    baseMaterials.set(name, ownMaterial);
    return mesh;
  };

  const torso = zone('torso', new THREE.CapsuleGeometry(0.72, 0.72, 8, 18), [0, 2.72, 0]);
  torso.scale.set(1.05, 1.12, 0.62);
  zone('head', new THREE.SphereGeometry(0.64, 28, 20), [0, 4.04, 0], team);
  const leftArm = zone('leftArm', new THREE.CapsuleGeometry(0.25, 0.92, 7, 14), [-0.98, 2.7, 0], white);
  const rightArm = zone('rightArm', new THREE.CapsuleGeometry(0.25, 0.92, 7, 14), [0.98, 2.7, 0], white);
  leftArm.rotation.z = -0.12;
  rightArm.rotation.z = 0.12;
  const leftLeg = zone('leftLeg', new THREE.CapsuleGeometry(0.3, 0.9, 7, 14), [-0.42, 1.02, 0], navy);
  const rightLeg = zone('rightLeg', new THREE.CapsuleGeometry(0.3, 0.9, 7, 14), [0.42, 1.02, 0], navy);

  const visor = shadow(new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 12, 0, Math.PI * 2, 0.45, 1.15), dark));
  visor.scale.set(1, 0.62, 0.42);
  visor.position.set(0, 4.08, 0.49);
  visor.rotation.x = 0.18;
  group.add(visor);
  const visorGlow = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.08, 0.05), glow);
  visorGlow.position.set(0, 4.08, 0.69);
  group.add(visorGlow);

  const chestPlate = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.58, 0.18), team));
  chestPlate.position.set(0, 2.78, 0.52);
  chestPlate.rotation.x = -0.08;
  group.add(chestPlate);
  const emblem = new THREE.Mesh(new THREE.OctahedronGeometry(0.16), glow);
  emblem.position.set(0, 2.8, 0.64);
  group.add(emblem);

  for (const x of [-0.98, 0.98]) {
    const shoulder = shadow(new THREE.Mesh(new THREE.SphereGeometry(0.36, 16, 12), team));
    shoulder.scale.y = 0.72;
    shoulder.position.set(x, 3.3, 0);
    group.add(shoulder);
  }
  for (const x of [-0.42, 0.42]) {
    const boot = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.34, 0.9), team));
    boot.position.set(x, 0.22, 0.18);
    group.add(boot);
  }

  const tank = shadow(new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.72, 8, 16), team));
  tank.position.set(0, 2.8, -0.55);
  group.add(tank);
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
  group.userData.leftArm = leftArm;
  group.userData.rightArm = rightArm;
  group.userData.leftLeg = leftLeg;
  group.userData.rightLeg = rightLeg;
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

function arenaBarrier(width: number, color: number) {
  const group = new THREE.Group();
  const frame = physical(0x172554, 0.45, 0.28);
  const panel = physical(color, 0.12, 0.36);
  const base = shadow(new THREE.Mesh(new THREE.BoxGeometry(width + 0.38, 0.24, 1.34), frame));
  base.position.y = 0.12;
  group.add(base);
  const body = shadow(new THREE.Mesh(new THREE.BoxGeometry(width, 1.18, 0.92), panel));
  body.position.y = 0.83;
  group.add(body);
  const cap = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, width, 18), panel));
  cap.rotation.z = Math.PI / 2;
  cap.position.y = 1.42;
  group.add(cap);
  const stripeMaterial = physical(0xfde047, 0.08, 0.3);
  for (const x of [-width * 0.32, width * 0.32]) {
    const brace = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.32, 1.02), stripeMaterial));
    brace.position.set(x, 0.84, 0);
    group.add(brace);
  }
  for (const x of [-width / 2 + 0.18, width / 2 - 0.18]) {
    const foot = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.18, 1.78), frame));
    foot.position.set(x, 0.09, 0);
    group.add(foot);
    const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.08, 10), stripeMaterial);
    bolt.position.set(x, 0.21, 0.62);
    group.add(bolt);
  }
  const inset = new THREE.Mesh(new THREE.BoxGeometry(width * 0.42, 0.42, 0.06), frame);
  inset.position.set(0, 0.9, 0.49);
  group.add(inset);
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
  const coverData: Array<[number, number, number, number]> = [
    [-4.4, -1.5, 2.8, 0x22d3ee], [4.4, 1.5, 2.8, 0xfb7185], [0, -6.2, 4.4, 0xf97316], [0, 6.2, 4.4, 0xfde047],
  ];
  for (const [x, z, width, color] of coverData) {
    const cover = arenaBarrier(width, color);
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
