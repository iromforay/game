import type { BattleSnapshot } from '../net/battleTypes';
import Phaser from 'phaser';
import { apiStoryClient } from '../story/apiStoryClient';
import { getPlayerId } from '../state/player';
import type { StoryDialogueData } from './StoryDialogueScene';
import { chapterOfStage } from '../story/storyFlow';
import { InventoryWindow } from '../ui/InventoryWindow';
import { displayScaleOf } from '../ui/responsive';
import { watchLayout } from '../ui/relayout';
import { villageHudLayout, type VillageHudLayout } from '../ui/screenLayouts';
import { playStory } from '../story/playStory';
import { CANVAS_HEIGHT, AVATAR_SPEED } from '../config/constants';
import { AVATAR_IMAGE, BACKGROUND_TILES } from '../assets/registry';
import { loadWorldImages } from '../assets/loader';
import { ensureVillagePlaceholders } from '../assets/placeholders';
import { getVillageLayout, getVillagePaths } from '../config/village';
import { loadChapterStatuses, getCurrentChapter } from '../config/story';
import { OPENING_REQUIRED_MESSAGE, openingLocked } from '../story/storyClient';
import type { Rect, VillageInteraction, VillageLayout } from '../config/village';
import { VirtualJoystick } from '../ui/VirtualJoystick';
import { MiniMap } from '../ui/MiniMap';
import type { MapMarker, MapView } from '../ui/MiniMap';
import { inventory } from '../state/inventory';
import { roomClient } from '../net/roomClient';
import { deferredRestore, RESTORE_BATTLE_LABEL, RESTORE_BATTLE_TEXT, shouldPromptBattle } from '../state/restoreAttempt';
import { feltPanel, pillButton, TEXT } from '../ui/kit';

type Facing = 'down' | 'left' | 'right' | 'up';
const FACING_ROW: Record<Facing, number> = { down: 0, left: 1, right: 2, up: 3 };

// docs/save_a_turby_asset.md §7.2 레이어: 0 지면 / 10 길 / 100+Y 오브젝트·캐릭터 / 2000 전경 / 3000 프롬프트 / 4000 HUD / 5000 모달
const DEPTH_GROUND = 0;
const DEPTH_PATH = 10;
const DEPTH_Y_BASE = 100;
const DEPTH_FOREGROUND = 2000;
const DEPTH_PROMPT = 3000;
const DEPTH_HUD = 4000;

// 코덱스 납품 HUD 패널(크림색) 위 글자색 — docs to_claude v3
const HUD_TEXT = '#695B67';
const SHADOW_COLOR = 0x695b67; // 펠트 지면 위에서 딱딱해 보이지 않도록 검정 대신 보라빛 갈색
const FOOT_W = 28;
const FOOT_H = 18;

// 4.1: 마을 — 야생 터비가 없는 안전지대. 지면·길·오브젝트·캐릭터·HUD 레이어로 구성한 JRPG 필드(코덱스 확정 2026-09-21).
// 이미지는 assets/world·sprites·ui에 최종 파일명으로 들어오면 자동 로드되고, 없으면 임시 도형으로 대체된다.
export class VillageScene extends Phaser.Scene {
  private joystick!: VirtualJoystick;
  private miniMap!: MiniMap;
  private avatar!: Phaser.GameObjects.Sprite;
  private avatarShadow!: Phaser.GameObjects.Ellipse;
  private layout!: VillageLayout;
  private colliders: Rect[] = [];
  private keys!: {
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
    w: Phaser.Input.Keyboard.Key;
    a: Phaser.Input.Keyboard.Key;
    s: Phaser.Input.Keyboard.Key;
    d: Phaser.Input.Keyboard.Key;
    interact: Phaser.Input.Keyboard.Key[];
  };
  private prompt!: Phaser.GameObjects.Container;
  private promptLabel!: Phaser.GameObjects.Text;
  private activeInteraction: VillageInteraction | null = null;
  private facing: Facing = 'down';
  private moveAngle = Math.PI / 2;
  private hasWalkSheet = false;
  private hasIdleSheet = false;
  private ready = false;
  private locked = false;
  private paused = false;
  private hud!: VillageHudLayout;
  private hudObjs: Phaser.GameObjects.GameObject[] = [];
  private invWindow: InventoryWindow | null = null;
  private generation = 0; // 화면을 다시 만들 때마다 증가 — 이전 화면의 늦은 응답이 새 화면에 덧그리지 않게

  constructor() {
    super('Village');
  }

  preload() {
    if (!this.textures.exists('bg-village')) this.load.image('bg-village', BACKGROUND_TILES.village);
    if (!this.textures.exists('avatar')) this.load.image('avatar', AVATAR_IMAGE);
    loadWorldImages(this);
  }

  async create() {
    const gen = ++this.generation;
    this.ready = false;
    this.locked = false;
    this.paused = false;
    this.activeInteraction = null;
    this.facing = 'down';
    this.moveAngle = Math.PI / 2;
    this.hudObjs = [];
    this.invWindow = null;

    this.layout = await getVillageLayout();
    if (gen !== this.generation || !this.sys.isActive()) return; // 기다리는 사이 화면이 바뀜
    const layout = this.layout;
    ensureVillagePlaceholders(this, layout);

    this.cameras.main.setBackgroundColor('#3a3626');
    this.cameras.main.fadeIn(250);

    // 0 지면 / 10 길 — 최종 지면 이미지가 없으면 기존 타일을 반복해서 대신한다
    if (this.textures.exists('village-ground-base')) this.add.image(0, 0, 'village-ground-base').setOrigin(0, 0).setDepth(DEPTH_GROUND);
    else this.add.tileSprite(0, 0, layout.width, layout.height, 'bg-village').setOrigin(0, 0).setDepth(DEPTH_GROUND);
    this.add.image(0, 0, 'village-path-overlay').setOrigin(0, 0).setDepth(DEPTH_PATH);
    for (const [key, depth] of [['village-ground-detail', DEPTH_PATH + 1], ['village-boundary-overlay', DEPTH_PATH + 2]] as const) {
      if (this.textures.exists(key)) this.add.image(0, 0, key).setOrigin(0, 0).setDepth(depth);
    }

    // 100+Y 오브젝트 — 발밑 기준점(x, y)을 깊이와 충돌의 기준으로 삼는다
    this.colliders = [...(layout.blockers ?? [])];
    for (const obj of layout.objects) {
      const depth = DEPTH_Y_BASE + obj.y;
      if (obj.shadow) this.add.ellipse(obj.x, obj.y, obj.shadow.w, obj.shadow.h, SHADOW_COLOR, obj.shadow.alpha ?? 0.16).setDepth(depth - 0.5);
      this.add.image(obj.x, obj.y, obj.key).setOrigin(obj.origin[0], obj.origin[1]).setScale(obj.scale ?? 1).setDepth(depth);
      for (const c of obj.colliders ?? []) this.colliders.push({ x: obj.x + c.dx, y: obj.y + c.dy, w: c.w, h: c.h });
    }
    if (this.textures.exists('village-foreground')) this.add.image(0, 0, 'village-foreground').setOrigin(0, 0).setDepth(DEPTH_FOREGROUND);

    this.createAvatar();
    this.createHud();
    this.createPrompt();
    // 창 크기가 바뀌어 배치 기준이 달라지면 HUD와 안내 버튼만 다시 그린다(걷던 위치·열린 창은 그대로)
    watchLayout(this, () => {
      this.createHud();
      this.createPrompt();
      this.miniMap?.relayout(); // 미니맵·전체 지도도 새 배율로(열려 있으면 열린 채)
    });

    // 미니맵의 현재 목적지는 스토리 진행(docs/Turby_story.md)에서 온다 — 지금 열려 있는 장의 맵으로 가는 출구
    const { ok: storyOk, statuses } = await loadChapterStatuses();
    if (gen !== this.generation || !this.sys.isActive()) return;
    const current = getCurrentChapter(statuses);
    // 안내 문구: 구 판정(롤백)에서만 포획 안내. 서버 상태를 못 받으면 완료로 오해하지 않게 따로 안내한다.
    const storyHint = !storyOk
      ? '지역 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'
      : openingLocked(statuses)
        ? OPENING_REQUIRED_MESSAGE
        : current
        ? current.legacyTargetCode
          ? `${current.chapter.titleKo}: ${current.stageName}에서 '${current.clearCharacterName}'를 직접 포획해 보세요.`
          : `${current.chapter.titleKo}: ${current.stageName} 탐험`
        : '모든 장을 완료했어요. 다음 이야기를 기다려 주세요.';
    const markers: MapMarker[] = layout.interactions.map((it) => ({
      id: it.id,
      type: it.type,
      name: it.name,
      x: it.zone.x + it.zone.w / 2,
      y: it.zone.y + it.zone.h / 2,
      hint: it.type === 'exit' ? `${it.hint}

${storyHint}` : it.hint,
    }));
    const view: MapView = { title: '마을', width: layout.width, height: layout.height, bounds: layout.walkBounds, paths: getVillagePaths(layout) };
    this.joystick = new VirtualJoystick(this);
    this.miniMap = new MiniMap(this, view, markers, layout.defaultDestinationId, (open) => {
      this.paused = open;
      this.joystick.setEnabled(!open);
      if (open) this.setActiveInteraction(null);
    });

    const kb = this.input.keyboard!;
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = {
      up: kb.addKey(K.UP),
      down: kb.addKey(K.DOWN),
      left: kb.addKey(K.LEFT),
      right: kb.addKey(K.RIGHT),
      w: kb.addKey(K.W),
      a: kb.addKey(K.A),
      s: kb.addKey(K.S),
      d: kb.addKey(K.D),
      interact: [kb.addKey(K.E), kb.addKey(K.SPACE), kb.addKey(K.ENTER)],
    };

    this.ready = true;
    this.resumeBattleIfAny();
  }

  private createAvatar() {
    const layout = this.layout;
    this.hasWalkSheet = this.textures.exists('child-walk') && this.textures.get('child-walk').frameTotal > 4;
    this.hasIdleSheet = this.textures.exists('child-idle') && this.textures.get('child-idle').frameTotal > 4;

    if (this.hasWalkSheet) {
      for (const [dir, row] of Object.entries(FACING_ROW)) {
        if (!this.anims.exists(`walk-${dir}`)) {
          this.anims.create({ key: `walk-${dir}`, frames: this.anims.generateFrameNumbers('child-walk', { start: row * 4, end: row * 4 + 3 }), frameRate: 8, repeat: -1 });
        }
        if (this.hasIdleSheet && !this.anims.exists(`idle-${dir}`)) {
          this.anims.create({ key: `idle-${dir}`, frames: this.anims.generateFrameNumbers('child-idle', { start: row * 2, end: row * 2 + 1 }), frameRate: 3, repeat: -1 });
        }
      }
    }

    this.avatarShadow = this.add.ellipse(layout.avatarStart.x, layout.avatarStart.y, 44, 14, SHADOW_COLOR, 0.2);
    const texture = this.hasWalkSheet ? (this.hasIdleSheet ? 'child-idle' : 'child-walk') : 'avatar';
    this.avatar = this.add.sprite(layout.avatarStart.x, layout.avatarStart.y, texture).setOrigin(0.5, 0.92);
    this.avatar.setDisplaySize(this.hasWalkSheet ? 84 : 64, this.hasWalkSheet ? 84 : 64);
    this.playAvatarAnim(false);
  }

  // HUD: 재화·지역 이름·인벤토리 버튼(villageHudLayout — 표시 배율별 크기, 서로 겹치지 않음). 창 크기가 바뀌면 HUD만 다시 그린다
  private createHud() {
    this.hudObjs.forEach((o) => o.destroy());
    const L = (this.hud = villageHudLayout(displayScaleOf(this.scale.displaySize.width)));
    const fix = <T extends Phaser.GameObjects.GameObject>(o: T) => {
      (o as unknown as Phaser.GameObjects.Image).setScrollFactor(0);
      this.hudObjs.push(o);
      return o;
    };
    this.hudObjs = [];
    fix(this.add.image(L.coin.x, L.coin.y, 'hud-coin-panel').setOrigin(0, 0).setDisplaySize(L.coin.w, L.coin.h).setDepth(DEPTH_HUD));
    fix(this.add.text(L.coin.x + L.coin.w / 2, L.coin.y + L.coin.h / 2, `타레 ${inventory.getTareBalance()}`, { fontSize: `${L.font.coin}px`, color: HUD_TEXT }).setOrigin(0.5).setDepth(DEPTH_HUD + 1));
    fix(this.add.image(L.title.x, L.title.y, 'hud-area-panel').setOrigin(0, 0).setDisplaySize(L.title.w, L.title.h).setDepth(DEPTH_HUD));
    fix(this.add.text(L.title.x + L.title.w / 2, L.title.y + L.title.h / 2, '마을', { fontSize: `${L.font.title}px`, color: HUD_TEXT }).setOrigin(0.5).setDepth(DEPTH_HUD + 1));

    // v3 M4-D: 아이템 인벤토리(창이 열린 동안 이동 멈춤). 창 자체는 한 번만 만든다(HUD를 다시 그려도 열린 창·리스너가 늘지 않게)
    this.invWindow ??= new InventoryWindow(this, { onClose: () => (this.locked = false), onPlay: (play) => playStory(this, play, 'forest') });
    const V = L.inventory;
    const invBox = fix(this.add.rectangle(V.x, V.y, V.w, V.h, 0x5a3a8a).setOrigin(0, 0).setDepth(DEPTH_HUD + 1));
    fix(this.add.text(V.x + V.w / 2, V.y + V.h / 2, '인벤토리', { fontSize: `${L.font.button}px`, color: '#ffffff' }).setOrigin(0.5).setDepth(DEPTH_HUD + 2));
    invBox.setInteractive({ useHandCursor: true }).on('pointerdown', () => {
      if (this.invWindow!.isVisible || this.paused) return;
      this.locked = true;
      void this.invWindow!.open();
    });

    fix(
      this.add
        .text(16, CANVAS_HEIGHT - 20, `플레이어: ${inventory.getPlayerId().slice(0, 8)}`, { fontSize: '11px', color: '#ffffff' })
        .setOrigin(0, 1)
        .setAlpha(0.45)
        .setDepth(DEPTH_HUD),
    );
  }

  // 상호작용 안내 버튼(들어가기 등): 아바타 머리 위. 크기·글자는 표시 배율에 맞춘다
  private createPrompt() {
    this.prompt?.destroy();
    const P = this.hud.prompt;
    const bg = this.add.image(0, 0, 'prompt-interact').setDisplaySize(P.w, P.h);
    this.promptLabel = this.add.text(0, 0, this.activeInteraction?.prompt ?? '', { fontSize: `${this.hud.font.prompt}px`, color: HUD_TEXT }).setOrigin(0.5);
    this.prompt = this.add.container(0, 0, [bg, this.promptLabel]).setDepth(DEPTH_PROMPT).setVisible(!!this.activeInteraction);
    bg.setInteractive({ useHandCursor: true }).on('pointerdown', () => {
      if (this.activeInteraction && !this.paused && !this.locked) this.triggerInteraction(this.activeInteraction);
    });
  }

  private playAvatarAnim(moving: boolean) {
    if (!this.hasWalkSheet) return;
    const dir = this.facing;
    if (moving) this.avatar.anims.play(`walk-${dir}`, true);
    else if (this.hasIdleSheet) this.avatar.anims.play(`idle-${dir}`, true);
    else {
      this.avatar.anims.stop();
      this.avatar.setFrame(FACING_ROW[dir] * 4);
    }
  }

  private blocked(x: number, y: number) {
    const foot = new Phaser.Geom.Rectangle(x - FOOT_W / 2, y - FOOT_H, FOOT_W, FOOT_H);
    return this.colliders.some((c) => Phaser.Geom.Intersects.RectangleToRectangle(foot, new Phaser.Geom.Rectangle(c.x, c.y, c.w, c.h)));
  }

  // 4-B: 새로고침·재접속으로 돌아왔을 때 서버에 진행 중인 전투가 있으면 그 전투로 이어서 들어간다(서버에 닿지 않으면 조용히 무시)
  // 10-06 v1 §6: 복원 화면에서 서버를 확인하지 못한 채 마을로 나온 경우(deferredRestore)에는 연결이 돌아왔을 때 접속 인증 결과를 다시 확인하고,
  // 활성 전투가 남아 있으면 자동으로 끌고 가지 않고 새 활동을 시작하기 전에 복원 안내를 보인다
  private resumeBattleIfAny() {
    void roomClient
      .connect()
      .then(() => this.checkServerBattle())
      .catch(() => undefined);
    if (deferredRestore.isPending) {
      const off = roomClient.on('reconnected', () => this.checkServerBattle());
      this.events.once('shutdown', off);
    }
  }

  private checkServerBattle() {
    if (!this.scene.isActive()) return;
    const battle = roomClient.activeBattle;
    if (!shouldPromptBattle(deferredRestore.isPending, battle)) {
      if (!battle) deferredRestore.clear(); // 서버가 "남은 전투 없음"을 확인했다
      else resumeBattle(this, battle);
      return;
    }
    this.showRestorePrompt(battle!);
  }

  private restorePrompt: Phaser.GameObjects.GameObject[] = [];

  private showRestorePrompt(battle: BattleSnapshot) {
    if (this.restorePrompt.length > 0) return; // 접속 인증 결과가 여러 번 와도 한 번만
    this.locked = true; // 안내에 답하기 전에는 새 활동(집·시장·모험)을 시작하지 않는다
    this.joystick.setEnabled(false);
    const cx = this.scale.width / 2;
    const cy = CANVAS_HEIGHT / 2;
    const objs: Phaser.GameObjects.GameObject[] = [
      this.add.rectangle(cx, cy, this.scale.width, CANVAS_HEIGHT, 0x4a3a44, 0.55).setInteractive(),
      feltPanel(this, cx - 300, cy - 130, 600, 260, { radius: 28, strokeW: 6 }),
      this.add.text(cx, cy - 40, RESTORE_BATTLE_TEXT, { fontSize: '24px', color: TEXT.body, align: 'center', wordWrap: { width: 520 } }).setOrigin(0.5),
      pillButton(this, cx, cy + 60, 280, 76, RESTORE_BATTLE_LABEL, 'primary', () => {
        deferredRestore.clear();
        resumeBattle(this, battle);
      }),
    ];
    for (const o of objs) (o as Phaser.GameObjects.Text).setScrollFactor?.(0).setDepth?.(5000);
    this.restorePrompt = objs;
    this.events.once('shutdown', () => (this.restorePrompt = []));
  }

  // 진단용 요약(화면 상태만)
  get debugRestorePrompt() {
    return { shown: this.restorePrompt.length > 0, deferred: deferredRestore.isPending };
  }

  update(_time: number, delta: number) {
    if (!this.ready || this.locked) return;
    if (this.paused) {
      this.miniMap.update(this.avatar.x, this.avatar.y, this.moveAngle);
      return;
    }

    const k = this.keys;
    let vx = (k.right.isDown || k.d.isDown ? 1 : 0) - (k.left.isDown || k.a.isDown ? 1 : 0);
    let vy = (k.down.isDown || k.s.isDown ? 1 : 0) - (k.up.isDown || k.w.isDown ? 1 : 0);
    const joy = this.joystick.getVector();
    vx += joy.x * joy.magnitude;
    vy += joy.y * joy.magnitude;
    const len = Math.hypot(vx, vy);
    if (len > 1) {
      vx /= len;
      vy /= len;
    }

    const moving = len > 0.05;
    if (moving) {
      const dt = delta / 1000;
      const b = this.layout.walkBounds;
      const nx = Phaser.Math.Clamp(this.avatar.x + vx * AVATAR_SPEED * dt, b.x, b.x + b.w);
      if (!this.blocked(nx, this.avatar.y)) this.avatar.x = nx;
      const ny = Phaser.Math.Clamp(this.avatar.y + vy * AVATAR_SPEED * dt, b.y, b.y + b.h);
      if (!this.blocked(this.avatar.x, ny)) this.avatar.y = ny;

      this.facing = Math.abs(vx) > Math.abs(vy) ? (vx < 0 ? 'left' : 'right') : vy < 0 ? 'up' : 'down';
      this.moveAngle = Math.atan2(vy, vx);
    }
    this.playAvatarAnim(moving);
    this.avatar.setDepth(DEPTH_Y_BASE + this.avatar.y);
    this.avatarShadow.setPosition(this.avatar.x, this.avatar.y).setDepth(DEPTH_Y_BASE + this.avatar.y - 0.5);
    this.miniMap.update(this.avatar.x, this.avatar.y, this.moveAngle);

    const hit = this.layout.interactions.find((it) => Phaser.Geom.Rectangle.Contains(new Phaser.Geom.Rectangle(it.zone.x, it.zone.y, it.zone.w, it.zone.h), this.avatar.x, this.avatar.y));
    this.setActiveInteraction(hit ?? null);
    if (hit) this.prompt.setPosition(this.avatar.x, this.avatar.y - this.hud.prompt.lift - 44); // 문·입구 그림을 가리지 않게 캐릭터 머리 위에 표시
    if (hit && k.interact.some((key) => Phaser.Input.Keyboard.JustDown(key))) this.triggerInteraction(hit);
  }

  private setActiveInteraction(it: VillageInteraction | null) {
    if (it === this.activeInteraction) return;
    this.activeInteraction = it;
    if (!it) {
      this.prompt.setVisible(false);
      return;
    }
    this.promptLabel.setText(it.prompt);
    this.prompt.setVisible(true);
  }

  private triggerInteraction(it: VillageInteraction) {
    this.locked = true;
    this.joystick.setEnabled(false);
    this.cameras.main.fadeOut(250);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      if (it.type === 'home') this.scene.start('Home');
      else if (it.type === 'market') this.scene.start('Market');
      else this.scene.start('StageSelect');
    });
  }
}

// 진행 중이던 전투로 이어서 들어간다(Boot의 복원과 마을의 재접속이 같은 진입을 쓴다).
// M4-C: 스토리 전투면 끝난 뒤 그 전투 항목부터 대화를 잇는다(대화 위치 복원). 그 구간 뒤는 맵 재입장 때 서버가 알려 준다
export function resumeBattle(scene: Phaser.Scene, battle: BattleSnapshot) {
  const returnTo = battle.story ? { scene: 'StoryDialogue', mode: 'start' as const, data: storyResumeData(battle.stageCode, battle.story.encounterKey) } : undefined;
  scene.scene.start('Battle', { stageCode: battle.stageCode, capturedIndices: [], removedIndices: [], snapshot: battle, returnTo });
}

// 새로고침으로 스토리 전투부터 복원할 때의 대화 화면 데이터: 끝나면 그 지역 맵으로(재입장 시 서버가 다음 구간을 알려 줌)
function storyResumeData(stageCode: string, encounterKey: string): StoryDialogueData {
  return {
    client: apiStoryClient,
    seenKey: `turby_seen_segments:${getPlayerId()}`,
    stageCode,
    resumeBattle: { encounterKey, chapterCode: chapterOfStage(stageCode) },
    onDone: (s) => {
      s.scene.start('Map', { stageCode });
    },
  };
}
