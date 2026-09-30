import Phaser from 'phaser';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../config/constants';
import { AVATAR_IMAGE, BACKGROUND_TILES, CHARACTER_IMAGES, PORTRAIT_IMAGES } from '../assets/registry';
import { loadWorldImages } from '../assets/loader';
import { PAL, TEXT, feltPanel, pillButton } from '../ui/kit';
import { portraitCandidates, runDialogue, type Advance, type DialogueEntry, type DialogueFile, type NameSubmitResult, type RunnerPorts, type ShownLine } from '../story/dialogueRunner';
import { NAME_RULE_TEXT, nameReasonMessage, precheckName } from '../story/nameRules';
import type { OpeningStoryState, StoryClient } from '../story/storyClient';

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

// 대사 표시·입력은 1장 대화 화면(StoryDialogueScene)도 그대로 쓴다(상속) — 재생 범위와 전투 연결만 다르다
export class OpeningScene extends Phaser.Scene {
  protected opts!: OpeningSceneData;
  protected state!: OpeningStoryState;
  protected seen = new Set<string>();
  private bg?: Phaser.GameObjects.TileSprite;
  private layer!: Phaser.GameObjects.Container;
  private advanceResolver: ((a: Advance) => void) | null = null;
  private typing: Phaser.Time.TimerEvent | null = null;
  private fullText = '';
  private textObj!: Phaser.GameObjects.Text;

  constructor(key = 'Opening') {
    super(key);
  }

  init(data: OpeningSceneData) {
    this.opts = data;
    this.advanceResolver = null;
    this.typing = null;
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
        const label = this.add.text(0, 0, line.label, { fontSize: '22px', color: TEXT.body });
        const w = Math.max(120, label.width + 48);
        this.layer.add(feltPanel(this, BOX.x + 28, BOX.y - 24, w, 48, { radius: 24, fill: entry.kind === 'line' && entry.speaker === 'nubi' ? PAL.pink : PAL.lavender, stroke: PAL.cream, strokeW: 4 }));
        label.setPosition(BOX.x + 28 + w / 2, BOX.y).setOrigin(0.5);
        this.layer.add(label);
      }
      this.textObj = this.add.text(BOX.x + 44, BOX.y + 44, '', {
        fontSize: '26px',
        color: entry.kind === 'narration' ? TEXT.sub : TEXT.body,
        wordWrap: { width: BOX.w - 88, useAdvancedWrap: true },
        lineSpacing: 10,
      });
      this.layer.add(this.textObj);
      const arrow = this.add.text(BOX.x + BOX.w - 44, BOX.y + BOX.h - 36, '▼', { fontSize: '22px', color: TEXT.sub }).setOrigin(0.5);
      this.tweens.add({ targets: arrow, y: arrow.y + 6, duration: 600, yoyo: true, repeat: -1 });
      this.layer.add(arrow);
    }

    if (line.canSkipSegment) {
      this.layer.add(pillButton(this, CANVAS_WIDTH - 130, 60, 220, 88, '건너뛰기', 'secondary', () => this.resolveAdvance('skip')));
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
  }

  // ---------- 이름 입력 ----------

  private askName(prompt: string, submit: (name: string) => Promise<NameSubmitResult>): Promise<void> {
    this.clearLayer();
    // 640×360에서도 입력창·버튼이 44px 이상(캔버스 88px)이 되도록 크게 잡는다
    const panel = { x: 240, y: 70, w: 800, h: 560 };
    this.layer.add(this.add.rectangle(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT, PAL.cream, 0.72).setOrigin(0, 0).setInteractive());
    this.layer.add(feltPanel(this, panel.x, panel.y, panel.w, panel.h, { radius: 36, fill: PAL.cream, stroke: PAL.lavender, strokeW: 6 }));
    this.layer.add(this.add.text(CANVAS_WIDTH / 2, panel.y + 70, prompt, { fontSize: '32px', color: TEXT.body, align: 'center', wordWrap: { width: panel.w - 80 } }).setOrigin(0.5));

    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 12;
    input.autocomplete = 'off';
    input.setAttribute('aria-label', '이름');
    input.style.cssText = `width:480px;height:88px;box-sizing:border-box;padding:0 24px;font-size:36px;border-radius:44px;border:4px solid #dcd3f4;background:#fffaf1;color:${TEXT.body};outline:none;text-align:center;font-family:inherit`;
    const detach = this.overlayElement(input, CANVAS_WIDTH / 2, panel.y + 176, 480, 88);
    this.layer.add(this.add.text(CANVAS_WIDTH / 2, panel.y + 262, NAME_RULE_TEXT, { fontSize: '24px', color: TEXT.sub }).setOrigin(0.5));
    const error = this.add.text(CANVAS_WIDTH / 2, panel.y + 320, '', { fontSize: '24px', color: TEXT.error, align: 'center', wordWrap: { width: panel.w - 80 } }).setOrigin(0.5);
    this.layer.add(error);

    return new Promise<void>((resolve) => {
      let busy = false;
      const send = async () => {
        if (busy) return;
        const checked = precheckName(input.value);
        if (!checked.ok) {
          error.setText(nameReasonMessage(checked.reason));
          return;
        }
        busy = true;
        error.setText('');
        const res = await submit(checked.name);
        busy = false;
        if (res.ok) {
          detach();
          resolve();
          return;
        }
        error.setText(res.message);
      };
      this.layer.add(pillButton(this, CANVAS_WIDTH / 2, panel.y + panel.h - 90, 300, 88, '정했어요', 'primary', () => void send()));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') void send();
      });
      setTimeout(() => input.focus(), 50);
    });
  }

  // HTML 입력창을 캔버스 위 지정 좌표(캔버스 좌표계)에 겹친다. Phaser DOM 컨테이너는 부모가 flex 중앙정렬이면
  // 위치가 어긋나서(허브 .game-canvas-container, 640×360에서 확인) 캔버스의 실제 화면 위치·배율을 직접 따라간다.
  private overlayElement(el: HTMLElement, cx: number, cy: number, w: number, h: number): () => void {
    const canvas = this.game.canvas;
    el.style.position = 'fixed';
    el.style.zIndex = '20';
    el.style.transformOrigin = 'left top';
    const place = () => {
      const r = canvas.getBoundingClientRect();
      const s = r.width / CANVAS_WIDTH;
      el.style.left = `${r.left + (cx - w / 2) * s}px`;
      el.style.top = `${r.top + (cy - h / 2) * s}px`;
      el.style.transform = `scale(${s})`;
    };
    place();
    document.body.appendChild(el);
    window.addEventListener('resize', place);
    this.scale.on('resize', place);
    const detach = () => {
      window.removeEventListener('resize', place);
      this.scale.off('resize', place);
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
      this.layer.add(pillButton(this, CANVAS_WIDTH / 2, BOX.y + 136, 260, 88, '다시 시도', 'primary', () => resolve()));
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
