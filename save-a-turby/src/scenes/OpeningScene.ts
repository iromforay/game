import Phaser from 'phaser';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../config/constants';
import { AVATAR_IMAGE, BACKGROUND_TILES, CHARACTER_IMAGES, PORTRAIT_IMAGES, SPRITESHEET_FRAMES } from '../assets/registry';
import { loadWorldImages } from '../assets/loader';
import { PAL, TEXT, feltPanel, pillButton } from '../ui/kit';
import { displayScaleOf, fontPx, MIN_BODY_PX, MIN_BUTTON_PX } from '../ui/responsive';
import { keyboardShift, nameInputLayout } from '../ui/screenLayouts';
import { portraitCandidates, runDialogue, type Advance, type DialogueEntry, type DialogueFile, type NameSubmitResult, type RunnerPorts, type ShownLine } from '../story/dialogueRunner';
import { NAME_RULE_TEXT, nameReasonMessage, precheckName } from '../story/nameRules';
import type { OpeningStoryState, StoryClient } from '../story/storyClient';

// 장 전용 대화 배경(한 장 그림, 화면 크기). 없으면 bg-<code> 타일(1·2장 숲·집)
const DIALOGUE_BACKDROPS: Record<string, { key: string; alpha: number }> = { underfloor: { key: 'chapter03-dialogue-bg', alpha: 0.8 }, fridge: { key: 'chapter04-dialogue-bg', alpha: 0.8 }, desert: { key: 'chapter05-dialogue-bg', alpha: 0.8 }, home_core: { key: 'final-dialogue-bg', alpha: 0.8 } };

// M3 오프닝 — 서버 체크포인트가 지정한 구간부터 공용 대사 재생기(story/dialogueRunner.ts)로 재생한다.
// 이 씬은 그리기와 입력만 맡는다. 진행·보상·체크포인트는 전부 서버가 판정한다.
export interface OpeningSceneData {
  client: StoryClient;
  state?: OpeningStoryState;
  seenKey: string; // 이미 본 구간 기록(localStorage) 키 — 기기별
  onDone: (scene: Phaser.Scene) => void | Promise<void>;
}

const BOX = { x: 40, y: 488, w: 1200, h: 200 };
const PORTRAIT = { x: 56, y: 276, size: 200 };
const TYPE_MS = 22;
const WORLD_SATURATION_DRAINED = 0.35; // 색 빠짐: 월드 채도(1 = 원래)
const WORLD_SATURATION_STEADY = 0.65; // 이름을 기억한 뒤 일부만 안정화(완전한 회복 아님)

// 대사 표시·입력은 1장 대화 화면(StoryDialogueScene)도 그대로 쓴다(상속) — 재생 범위와 전투 연결만 다르다
// 3장 기억 비침 cameraCue = 에셋 키(fx/story/<키>.png). 10-16 2차: 기억 조각(내 것이 아닌 기억)·은빛 실(장 마무리)도 같은 원형 연출
const MEMORY_GLIMPSE_KEYS = ['memory-glove', 'memory-blanket', 'memory-doll', 'memory-fragment', 'silver-thread', 'storage-pattern', 'frost-machine-scar', 'sense-restore', 'warm-gold', 'five-relics']; // 10-26 C5-3: 다섯 유물이 동시에 빛남(5장 마지막 마감)
// 10-23 C4-1 4장: 누비에게만 들리는 목소리 — 화자 없는 지문을 차가운 은색 글자로, 화면 가장자리에 서리(voice-frost)를 두른다
const VOICE_CUE = 'voice-frost';
// 10-26 C5-1: 5장 절단면 — 화면 가장자리 아지랑이 속 두 긴 날이 잠깐 닫혔다 사라진다(플레이어에게만). 가운데는 가리지 않는다. 그림이 없으면 그리지 않는다
const SCISSORS_GLIMPSE = 'scissors-glimpse';
const SCISSORS_REVEAL = 'scissors-reveal'; // 10-26 C5-3: 가위 첫 등장(아지랑이 너머 두 날, 아래 대화창 자리는 투명)
const VOICE_TEXT_COLOR = '#6f8aa3';

export class OpeningScene extends Phaser.Scene {
  protected opts!: OpeningSceneData;
  protected state!: OpeningStoryState;
  protected seen = new Set<string>();
  private bg?: Phaser.GameObjects.TileSprite | Phaser.GameObjects.Image;
  private layer!: Phaser.GameObjects.Container;
  private advanceResolver: ((a: Advance) => void) | null = null;
  private typing: Phaser.Time.TimerEvent | null = null;
  private glimpse: Phaser.GameObjects.Image | null = null; // 지금 떠 있는 기억 비침(연속 큐면 앞 것을 먼저 걷는다)
  private fullText = '';
  private textObj!: Phaser.GameObjects.Text;

  constructor(key = 'Opening') {
    super(key);
  }

  init(data: OpeningSceneData) {
    this.opts = data;
    this.advanceResolver = null;
    this.typing = null;
    this.fxState = { glimpseShown: [], glimpseBounds: null, drainPlayed: 0, saturation: 1, bounds: null, relicShown: 0, relicBounds: null, restorePlayed: 0, voiceShown: 0 }; this.glimpse = null; // 같은 장면 객체를 다시 쓸 때 연출 상태를 비운다
    this.fxNubi = undefined;
    this.fxRelic = undefined;
    this.satTween = undefined;
    try {
      this.seen = new Set(JSON.parse(localStorage.getItem(data.seenKey) ?? '[]') as string[]);
    } catch {
      this.seen = new Set();
    }
  }

  preload() {
    loadWorldImages(this);
    for (const [key, url] of Object.entries(PORTRAIT_IMAGES)) if (!this.textures.exists(key)) this.load.image(key, url);
    if (!this.textures.exists('avatar')) this.load.image('avatar', AVATAR_IMAGE);
    if (!this.textures.exists('turby-nubi')) this.load.image('turby-nubi', CHARACTER_IMAGES.nubi);
    for (const code of ['home', 'forest']) if (!this.textures.exists(`bg-${code}`)) this.load.image(`bg-${code}`, BACKGROUND_TILES[code]);
  }

  async create() {
    this.cameras.main.setBackgroundColor('#F7E9D2');
    this.layer = this.add.container(0, 0).setDepth(10);
    this.input.keyboard?.on('keydown-SPACE', () => this.tapAdvance());
    this.input.keyboard?.on('keydown-ENTER', () => this.tapAdvance());

    await this.runStory();
    this.clearLayer();
    await this.opts.onDone(this);
  }

  // 재생 범위: 오프닝은 서버 복귀 구간부터 오프닝 끝까지(1장 대화 화면은 이 부분만 바꾼다)
  protected async runStory() {
    const file = await this.retrying(() => this.opts.client.fetchDialogue('opening'), '이야기를 불러오지 못했어요.');
    this.state = this.opts.state ?? (await this.retrying(() => this.opts.client.fetchState(), '이야기 진행 정보를 불러오지 못했어요.'));
    const start = this.state.resume.segmentId;
    if (start && start.startsWith('opening.')) await runDialogue(file as DialogueFile, start, this.ports());
  }

  // ---------- 재생기 연결 ----------

  protected ports(): RunnerPorts {
    return {
      show: (line) => this.showLine(line),
      cue: (entry) => this.playCue(entry),
      askName: (prompt, submit) => this.askName(prompt, submit),
      completeEvent: async (eventId) => {
        this.state = await this.opts.client.completeEvent(eventId);
      },
      saveName: async (name) => {
        this.state = await this.opts.client.saveName(name);
        return { playerName: this.state.playerName };
      },
      waitRetry: (message) => this.waitRetry(message),
      needsName: () => this.state.needsName,
      playerName: () => this.state.playerName,
      isSeen: (id) => this.seen.has(id),
      markSeen: (id) => {
        this.seen.add(id);
        try {
          localStorage.setItem(this.opts.seenKey, JSON.stringify([...this.seen]));
        } catch {
          // 저장 불가 — 이번 실행에서만 기억
        }
      },
      onSegment: (id) => this.setBackdrop(id === 'opening.fall' ? 'home' : 'forest'),
    };
  }

  // ---------- 화면 ----------

  protected setBackdrop(code: string) {
    this.bg?.destroy();
    this.bg = undefined;
    // 장 전용 한 장 배경(타일 아님)이 있으면 그것을 화면 크기로(10-22 C3-6 R1-04: 3장 마루 밑)
    const full = DIALOGUE_BACKDROPS[code];
    if (full && this.textures.exists(full.key)) {
      this.bg = this.add.image(0, 0, full.key).setOrigin(0, 0).setDisplaySize(CANVAS_WIDTH, CANVAS_HEIGHT).setDepth(0).setAlpha(full.alpha);
      return;
    }
    if (this.textures.exists(`bg-${code}`)) this.bg = this.add.tileSprite(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT, `bg-${code}`).setOrigin(0, 0).setDepth(0).setAlpha(0.55);
  }

  protected clearLayer() {
    this.layer.removeAll(true);
  }

  private showLine(line: ShownLine): Promise<Advance> {
    this.clearLayer();
    const { entry } = line;

    if (entry.kind === 'title') {
      this.layer.add(this.add.rectangle(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT, PAL.cream, 0.7).setOrigin(0, 0));
      this.layer.add(feltPanel(this, CANVAS_WIDTH / 2 - 260, CANVAS_HEIGHT / 2 - 60, 520, 120, { radius: 40, fill: PAL.cream, stroke: PAL.pink, strokeW: 6 }));
      this.textObj = this.add.text(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2, '', { fontSize: '40px', color: TEXT.body }).setOrigin(0.5);
      this.layer.add(this.textObj);
    } else {
      const portraitKey = entry.kind === 'line' ? portraitCandidates(entry.portrait, entry.expression).find((k) => this.textures.exists(k)) : undefined;
      if (entry.kind === 'line' && entry.portrait) this.drawPortrait(portraitKey);
      this.layer.add(feltPanel(this, BOX.x, BOX.y, BOX.w, BOX.h, { radius: 32, image: 'dialogue-box', fill: PAL.cream, stroke: PAL.lavender, strokeW: 6 }));
      if (line.label) {
        const label = this.add.text(0, 0, line.label, { fontSize: `${fontPx(displayScaleOf(this.scale.displaySize.width), 22, MIN_BODY_PX)}px`, color: TEXT.body });
        const w = Math.max(120, label.width + 48);
        this.layer.add(feltPanel(this, BOX.x + 28, BOX.y - 24, w, 48, { radius: 24, fill: entry.kind === 'line' && entry.speaker === 'nubi' ? PAL.pink : PAL.lavender, stroke: PAL.cream, strokeW: 4 }));
        label.setPosition(BOX.x + 28 + w / 2, BOX.y).setOrigin(0.5);
        this.layer.add(label);
      }
      this.textObj = this.add.text(BOX.x + 44, BOX.y + 44, '', {
        fontSize: '26px',
        color: entry.kind === 'narration' ? (entry.cameraCue === VOICE_CUE ? VOICE_TEXT_COLOR : TEXT.sub) : TEXT.body,
        fontStyle: entry.kind === 'narration' && entry.cameraCue === VOICE_CUE ? 'italic' : 'normal',
        wordWrap: { width: BOX.w - 88, useAdvancedWrap: true },
        lineSpacing: 10,
      });
      this.layer.add(this.textObj);
      const arrow = this.add.text(BOX.x + BOX.w - 44, BOX.y + BOX.h - 36, '▼', { fontSize: '22px', color: TEXT.sub }).setOrigin(0.5);
      this.tweens.add({ targets: arrow, y: arrow.y + 6, duration: 600, yoyo: true, repeat: -1 });
      this.layer.add(arrow);
    }

    if (line.canSkipSegment) {
      this.layer.add(pillButton(this, CANVAS_WIDTH - 130, 60, 220, 88, '건너뛰기', 'secondary', () => this.resolveAdvance('skip'), undefined, fontPx(displayScaleOf(this.scale.displaySize.width), 20, MIN_BUTTON_PX)));
    }
    // 화면 아무 곳이나 누르면 진행(버튼은 자체 처리)
    const hit = this.add.rectangle(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT, 0xffffff, 0).setOrigin(0, 0).setInteractive();
    hit.on('pointerdown', () => this.tapAdvance());
    this.layer.addAt(hit, 0);

    this.typeText(line.text);
    return new Promise<Advance>((resolve) => {
      this.advanceResolver = resolve;
    });
  }

  private drawPortrait(key: string | undefined) {
    this.layer.add(feltPanel(this, PORTRAIT.x, PORTRAIT.y, PORTRAIT.size, PORTRAIT.size, { radius: 36, fill: PAL.cream, stroke: PAL.lavender, strokeW: 6 }));
    const cx = PORTRAIT.x + PORTRAIT.size / 2;
    const cy = PORTRAIT.y + PORTRAIT.size / 2;
    if (key) {
      const img = this.add.image(cx, cy, key);
      const s = (PORTRAIT.size - 24) / Math.max(img.width, img.height);
      img.setScale(s);
      this.layer.add(img);
    } else {
      // 정본 초상화도 대체 그림도 없을 때의 임시 도형(에셋 확정 아님)
      this.layer.add(this.add.circle(cx, cy, 70, PAL.pink).setStrokeStyle(5, PAL.lavender));
    }
  }

  private typeText(text: string) {
    this.fullText = text;
    this.typing?.remove();
    let i = 0;
    const chars = [...text];
    this.typing = this.time.addEvent({
      delay: TYPE_MS,
      repeat: Math.max(0, chars.length - 1),
      callback: () => {
        i++;
        this.textObj.setText(chars.slice(0, i).join(''));
        if (i >= chars.length) this.typing = null;
      },
    });
  }

  // 글자가 나오는 중이면 한 번에 모두 표시, 다 나왔으면 다음으로
  private tapAdvance() {
    if (!this.advanceResolver) return;
    if (this.typing) {
      this.typing.remove();
      this.typing = null;
      this.textObj.setText(this.fullText);
      return;
    }
    this.resolveAdvance('next');
  }

  private resolveAdvance(a: Advance) {
    const r = this.advanceResolver;
    if (!r) return;
    this.advanceResolver = null;
    this.typing?.remove();
    this.typing = null;
    r(a);
  }

  // 사운드·카메라 큐: 에셋이 로드돼 있을 때만. 없으면 무음·무연출(오류 아님)
  private playCue(entry: DialogueEntry) {
    const sound = 'soundCue' in entry ? entry.soundCue : null;
    if (sound && this.cache.audio.exists(sound)) this.sound.play(sound);
    const cam = 'cameraCue' in entry ? entry.cameraCue : null;
    if (cam === 'nubi-color-drain') this.playNubiColorDrain();
    else if (cam === 'world-saturation-steady') this.setWorldSaturation(WORLD_SATURATION_STEADY);
    else if (cam === 'water-dye-yarn-rise') this.playRelicRise();
    else if (cam === 'nubi-color-restore') this.playNubiColorRestore();
    else if (cam && MEMORY_GLIMPSE_KEYS.includes(cam)) this.playMemoryGlimpse(cam);
    else if (cam === VOICE_CUE) this.playVoiceFrost();
    else if (cam === SCISSORS_GLIMPSE || cam === SCISSORS_REVEAL) this.playEdgeGlimpse(cam);
  }

  // ---------- 누비 색 빠짐 연출(10-13 C2-4) ----------
  // 누비 그림 위에 같은 중심으로 투명 오버레이를 1회 재생하고(캐릭터를 대체하지 않는다), 배경 채도를 부드럽게 낮춘다.
  // 대화창·이름표·버튼(this.layer)은 별도 레이어라 탈색되지 않는다. 붉은 화면·섬광·흔들림·시간 제한은 쓰지 않는다.
  fxState: { drainPlayed: number; saturation: number; bounds: { x: number; y: number; w: number; h: number } | null; relicShown: number; relicBounds: { x: number; y: number; w: number; h: number } | null; restorePlayed: number; glimpseShown: string[]; glimpseBounds: { x: number; y: number; w: number; h: number } | null; voiceShown: number } = { drainPlayed: 0, saturation: 1, bounds: null, relicShown: 0, relicBounds: null, restorePlayed: 0, glimpseShown: [], glimpseBounds: null, voiceShown: 0 };
  private fxNubi?: Phaser.GameObjects.Image;
  private fxRelic?: Phaser.GameObjects.Image;
  private satTween?: Phaser.Tweens.Tween;

  private playNubiColorDrain() {
    this.fxState.drainPlayed++;
    const cx = CANVAS_WIDTH / 2;
    const cy = 300;
    this.fxState.bounds = { x: cx - 120, y: cy - 120, w: 240, h: 240 }; // 오버레이가 차지하는 캔버스 영역(대화창·이름표·버튼과 겹치지 않아야 한다)
    if (this.textures.exists('turby-nubi') && !this.fxNubi) this.fxNubi = this.add.image(cx, cy, 'turby-nubi').setDisplaySize(200, 200).setDepth(5);
    const sheet = SPRITESHEET_FRAMES['nubi-color-drain'];
    if (this.textures.exists('nubi-color-drain') && sheet) {
      if (!this.anims.exists('nubi-color-drain-once')) this.anims.create({ key: 'nubi-color-drain-once', frames: this.anims.generateFrameNumbers('nubi-color-drain', { start: 0, end: sheet.frames - 1 }), frameRate: sheet.fps, repeat: 0 });
      const fx = this.add.sprite(cx, cy, 'nubi-color-drain').setOrigin(0.5, 0.5).setDisplaySize(240, 240).setDepth(6);
      fx.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => this.tweens.add({ targets: fx, alpha: 0, duration: 500, onComplete: () => fx.destroy() }));
      fx.play('nubi-color-drain-once');
    }
    this.setWorldSaturation(WORLD_SATURATION_DRAINED);
  }

  // ---------- 누비 색 회복 연출(10-14 C2-6) ----------
  // drain과 같은 누비 중심·피벗(240×240)에 회복 오버레이를 1→6 순서로 1회 재생하고, 채도를 안정 상태(0.65)에서 원래(1)로 천천히 올린다.
  // 누비 그림은 대체하지 않는다. 섬광·후광·왕관 없음
  private playNubiColorRestore() {
    this.fxState.restorePlayed++;
    const cx = CANVAS_WIDTH / 2;
    const cy = 300;
    this.fxState.bounds = { x: cx - 120, y: cy - 120, w: 240, h: 240 };
    if (this.textures.exists('turby-nubi') && !this.fxNubi) this.fxNubi = this.add.image(cx, cy, 'turby-nubi').setDisplaySize(200, 200).setDepth(5);
    const sheet = SPRITESHEET_FRAMES['nubi-color-restore'];
    if (this.textures.exists('nubi-color-restore') && sheet) {
      if (!this.anims.exists('nubi-color-restore-once')) this.anims.create({ key: 'nubi-color-restore-once', frames: this.anims.generateFrameNumbers('nubi-color-restore', { start: 0, end: sheet.frames - 1 }), frameRate: sheet.fps, repeat: 0 });
      const fx = this.add.sprite(cx, cy, 'nubi-color-restore').setOrigin(0.5, 0.5).setDisplaySize(240, 240).setDepth(6);
      fx.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => this.tweens.add({ targets: fx, alpha: 0, duration: 500, onComplete: () => fx.destroy() }));
      fx.play('nubi-color-restore-once');
    }
    this.setWorldSaturation(1, WORLD_SATURATION_STEADY);
  }

  // ---------- 기억 비침 연출(10-16 C3-2) ----------
  // 3장 물건 더미 조사 때 짧은 기억이 화면 중앙에 약 320px 원형으로 떠올랐다 사라진다. 얼굴·인물은 그림에 없다.
  // 섬광·흔들림·시간 제한 없음. 대화창·건너뛰기 버튼과 겹치지 않는 중앙(cy 300)에 둔다. 에셋이 없으면 아무것도 그리지 않는다(오류 아님)
  private playMemoryGlimpse(key: string) {
    this.fxState.glimpseShown.push(key);
    const cx = CANVAS_WIDTH / 2;
    const cy = 300;
    this.fxState.glimpseBounds = { x: cx - 160, y: cy - 160, w: 320, h: 320 };
    if (!this.textures.exists(key)) return;
    const prev = this.glimpse;
    if (prev?.active) {
      this.tweens.killTweensOf(prev);
      this.tweens.add({ targets: prev, alpha: 0, duration: 300, onComplete: () => prev.destroy() });
    }
    const img = this.add.image(cx, cy, key).setDisplaySize(320, 320).setAlpha(0).setDepth(6);
    this.glimpse = img;
    this.tweens.add({ targets: img, alpha: 0.95, duration: 700, ease: 'Sine.easeOut', yoyo: false });
    this.tweens.add({ targets: img, alpha: 0, delay: 3800, duration: 900, onComplete: () => { img.destroy(); if (this.glimpse === img) this.glimpse = null; } });
  }

  // ---------- 가장자리 연출 한 번(10-26 C5-1 가위 그림자) ----------
  // 0.4초에 걸쳐 떠올랐다가 1.6초 뒤 0.6초에 걸쳐 사라진다. 섬광·흔들림 없음. 그림이 없으면 기록만 남긴다(오류 아님)
  private playEdgeGlimpse(key: string) {
    this.fxState.glimpseShown.push(key);
    if (!this.textures.exists(key)) return;
    const img = this.add.image(0, 0, key).setOrigin(0, 0).setDisplaySize(CANVAS_WIDTH, CANVAS_HEIGHT).setAlpha(0).setDepth(7);
    this.tweens.add({ targets: img, alpha: 0.9, duration: 400, ease: 'Sine.easeOut' });
    this.tweens.add({ targets: img, alpha: 0, delay: 2000, duration: 600, onComplete: () => img.destroy() });
  }

  // ---------- 누비에게만 들리는 목소리(10-23 C4-1) ----------
  // 화면 가장자리에 서리가 번졌다가 천천히 걷힌다. 가운데(대화창·기억 비침)는 가리지 않는다. 그림이 없으면 옅은 가장자리 띠(임시)
  private playVoiceFrost() {
    this.fxState.voiceShown++;
    const objs: Phaser.GameObjects.GameObject[] = [];
    if (this.textures.exists(VOICE_CUE)) objs.push(this.add.image(0, 0, VOICE_CUE).setOrigin(0, 0).setDisplaySize(CANVAS_WIDTH, CANVAS_HEIGHT).setDepth(7));
    else {
      const band = 56;
      for (const [x, y, w, h] of [[0, 0, CANVAS_WIDTH, band], [0, CANVAS_HEIGHT - band, CANVAS_WIDTH, band], [0, 0, band, CANVAS_HEIGHT], [CANVAS_WIDTH - band, 0, band, CANVAS_HEIGHT]]) objs.push(this.add.rectangle(x, y, w, h, 0xdff3fb, 0.35).setOrigin(0, 0).setDepth(7));
    }
    for (const o of objs) {
      (o as Phaser.GameObjects.Image).setAlpha(0);
      this.tweens.add({ targets: o, alpha: 0.85, duration: 500, ease: 'Sine.easeOut' });
      this.tweens.add({ targets: o, alpha: 0, delay: 3200, duration: 900, onComplete: () => o.destroy() });
    }
  }

  // ---------- 물빛 염색실이 떠오르는 연출(10-14 C2-5B) ----------
  // 정본 승리 장면: 몸의 중심에서 푸른 물빛 염색실이 떠오른다. 화면 중앙(대화창·건너뛰기 버튼 밖)에 한 번 나타나 서서히 올라오고 장면 끝까지 머문다.
  // 섬광·흔들림·시간 제한 없음. 에셋이 없으면 아무것도 그리지 않는다(오류 아님)
  private playRelicRise() {
    if (this.fxRelic) return;
    const cx = CANVAS_WIDTH / 2;
    const cy = 300;
    this.fxState.relicShown++;
    this.fxState.relicBounds = { x: cx - 80, y: cy - 80, w: 160, h: 160 };
    if (!this.textures.exists('water-dye-yarn')) return;
    const img = this.add.image(cx, cy + 40, 'water-dye-yarn').setDisplaySize(160, 160).setAlpha(0).setDepth(6);
    this.fxRelic = img;
    this.tweens.add({ targets: img, alpha: 1, y: cy, duration: 1400, ease: 'Sine.easeOut' });
  }

  // 월드(배경·누비 그림)의 채도를 부드럽게 바꾼다. WebGL이 아니면 같은 방향의 회청색 틴트로 대신한다
  private setWorldSaturation(target: number, startFrom?: number) {
    const targets = [this.bg, this.fxNubi].filter((o): o is Phaser.GameObjects.TileSprite | Phaser.GameObjects.Image => !!o);
    if (targets.length === 0) return;
    const from = startFrom ?? this.fxState.saturation;
    this.satTween?.remove();
    const cms = targets.map((o) => (this.game.renderer.type === Phaser.WEBGL && o.postFX ? o.postFX.addColorMatrix() : null));
    const holder = { v: from };
    this.satTween = this.tweens.add({
      targets: holder,
      v: target,
      duration: 900,
      onUpdate: () => {
        this.fxState.saturation = holder.v;
        targets.forEach((o, i) => {
          const cm = cms[i];
          if (cm) {
            cm.reset();
            cm.saturate(holder.v - 1); // 1 = 원래 채도
          } else {
            const g = Math.round(255 - (1 - holder.v) * 70);
            o.setTint(Phaser.Display.Color.GetColor(g, g, 255 - Math.round((1 - holder.v) * 40)));
          }
        });
      },
    });
  }

  // ---------- 이름 입력 ----------

  private askName(prompt: string, submit: (name: string) => Promise<NameSubmitResult>): Promise<void> {
    this.clearLayer();
    // 입력창·규칙·오류 문구·확인 버튼을 모두 화면 위쪽 절반에 둔다 — 가상 키보드가 아래쪽을 가려도 보인다(nameInputLayout).
    // 640×360에서도 입력창·버튼이 40px 이상(캔버스 80px)이다. 안내 문구(대본)는 그대로.
    const L = nameInputLayout(displayScaleOf(this.scale.displaySize.width));
    const panel = L.panel;
    this.layer.add(this.add.rectangle(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT, PAL.cream, 0.72).setOrigin(0, 0).setInteractive());
    this.layer.add(feltPanel(this, panel.x, panel.y, panel.w, panel.h, { radius: 36, fill: PAL.cream, stroke: PAL.lavender, strokeW: 6 }));
    this.layer.add(this.add.text(CANVAS_WIDTH / 2, L.promptY, prompt, { fontSize: `${L.font.prompt}px`, color: TEXT.body, align: 'center', wordWrap: { width: panel.w - 80, useAdvancedWrap: true } }).setOrigin(0.5));

    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 12;
    input.autocomplete = 'off';
    input.setAttribute('aria-label', '이름');
    input.setAttribute('enterkeyhint', 'done');
    const I = L.input;
    input.style.cssText = `width:${I.w}px;height:${I.h}px;box-sizing:border-box;padding:0 24px;font-size:${L.font.input}px;border-radius:${I.h / 2}px;border:4px solid #dcd3f4;background:#fffaf1;color:${TEXT.body};outline:none;text-align:center;font-family:inherit`;
    // 입력창과 확인 버튼이 있는 줄은 가상 키보드가 올라와도 보이는 영역 안에 남긴다(visualViewport가 없으면 위쪽 배치 그대로)
    const detach = this.overlayElement(input, I.x + I.w / 2, I.y + I.h / 2, I.w, I.h, { top: Math.min(I.y, L.button.y), bottom: Math.max(I.y + I.h, L.button.y + L.button.h) });
    this.layer.add(this.add.text(CANVAS_WIDTH / 2, L.ruleY, NAME_RULE_TEXT, { fontSize: `${L.font.rule}px`, color: TEXT.sub }).setOrigin(0.5));
    const error = this.add.text(CANVAS_WIDTH / 2, L.errorY, '', { fontSize: `${L.font.rule}px`, color: TEXT.error, align: 'center', wordWrap: { width: panel.w - 80, useAdvancedWrap: true } }).setOrigin(0.5, 0);
    this.layer.add(error);

    return new Promise<void>((resolve) => {
      let busy = false;
      let done = false;
      const B = L.button;
      let button: Phaser.GameObjects.Container | null = null;
      // 확인 버튼: 저장 요청 중에는 "저장 중…"으로 바꾸고 누를 수 없게 한다(한 번의 입력 → 요청 한 번)
      const drawButton = () => {
        button?.destroy();
        button = pillButton(this, B.x + B.w / 2, B.y + B.h / 2, B.w, B.h, busy ? '저장 중…' : '정했어요', busy ? 'disabled' : 'primary', () => void send(), undefined, L.font.button);
        this.layer.add(button);
      };
      const send = async () => {
        if (busy || done) return;
        const checked = precheckName(input.value);
        if (!checked.ok) {
          error.setText(nameReasonMessage(checked.reason));
          return;
        }
        busy = true;
        input.disabled = true;
        error.setText('');
        drawButton();
        const res = await submit(checked.name);
        busy = false;
        if (!this.sys.isActive() || !error.active) return; // 기다리는 사이 화면이 바뀜
        if (res.ok) {
          done = true;
          detach();
          resolve();
          return;
        }
        input.disabled = false;
        error.setText(res.message);
        drawButton();
        input.focus();
      };
      drawButton();
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') void send();
      });
      setTimeout(() => input.focus(), 50);
    });
  }

  // HTML 입력창을 캔버스 위 지정 좌표(캔버스 좌표계)에 겹친다. Phaser DOM 컨테이너는 부모가 flex 중앙정렬이면
  // 위치가 어긋나서(허브 .game-canvas-container, 640×360에서 확인) 캔버스의 실제 화면 위치·배율을 직접 따라간다.
  // keepVisible(캔버스 좌표의 위·아래): 가상 키보드로 보이는 영역(visualViewport)이 줄어 이 줄이 가려지면 캔버스와 입력창을
  // 함께 위로 올린다. visualViewport를 지원하지 않는 브라우저에서는 아무것도 옮기지 않는다(위쪽 배치 그대로).
  private overlayElement(el: HTMLElement, cx: number, cy: number, w: number, h: number, keepVisible?: { top: number; bottom: number }): () => void {
    const canvas = this.game.canvas;
    const vv = keepVisible ? window.visualViewport : null;
    el.style.position = 'fixed';
    el.style.zIndex = '20';
    el.style.transformOrigin = 'left top';
    let shifted = false;
    const place = () => {
      if (shifted) canvas.style.transform = '';
      let r = canvas.getBoundingClientRect();
      const s = r.width / CANVAS_WIDTH;
      const shift = vv && keepVisible ? keyboardShift(r.top + keepVisible.top * s, r.top + keepVisible.bottom * s, vv.offsetTop, vv.offsetTop + vv.height) : 0;
      if (shift > 0) {
        canvas.style.transform = `translateY(${-shift}px)`;
        r = canvas.getBoundingClientRect();
      }
      if (shift > 0 || shifted) this.scale.updateBounds(); // 캔버스가 옮겨졌으면 Phaser의 입력 좌표 기준도 다시 잡는다(버튼이 보이는 자리에서 눌리게)
      shifted = shift > 0;
      el.style.left = `${r.left + (cx - w / 2) * s}px`;
      el.style.top = `${r.top + (cy - h / 2) * s}px`;
      el.style.transform = `scale(${s})`;
    };
    place();
    document.body.appendChild(el);
    window.addEventListener('resize', place);
    this.scale.on('resize', place);
    vv?.addEventListener('resize', place);
    vv?.addEventListener('scroll', place);
    let detached = false;
    const detach = () => {
      if (detached) return;
      detached = true;
      window.removeEventListener('resize', place);
      this.scale.off('resize', place);
      vv?.removeEventListener('resize', place);
      vv?.removeEventListener('scroll', place);
      if (shifted) {
        canvas.style.transform = '';
        this.scale.updateBounds();
      }
      el.remove();
    };
    this.events.once('shutdown', detach);
    return detach;
  }

  // ---------- 오류·재시도 ----------

  protected waitRetry(message: string): Promise<void> {
    this.clearLayer();
    this.layer.add(feltPanel(this, BOX.x, BOX.y, BOX.w, BOX.h, { radius: 32, fill: PAL.cream, stroke: 0xe9b7c2, strokeW: 6 }));
    this.layer.add(this.add.text(CANVAS_WIDTH / 2, BOX.y + 52, message, { fontSize: '24px', color: TEXT.error, align: 'center', wordWrap: { width: BOX.w - 88 } }).setOrigin(0.5));
    return new Promise<void>((resolve) => {
      this.layer.add(pillButton(this, CANVAS_WIDTH / 2, BOX.y + 136, 260, 88, '다시 시도', 'primary', () => resolve(), undefined, fontPx(displayScaleOf(this.scale.displaySize.width), 20, MIN_BUTTON_PX)));
    });
  }

  protected async retrying<T>(run: () => Promise<T>, message: string): Promise<T> {
    for (;;) {
      try {
        return await run();
      } catch (err) {
        console.warn('[opening]', err);
        await this.waitRetry(message);
      }
    }
  }
}
