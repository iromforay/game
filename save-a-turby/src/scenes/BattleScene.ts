import Phaser from 'phaser';
import { BATTLE_TILE_SIZE, BATTLE_GRID_COLS, BATTLE_GRID_ROWS, CANVAS_WIDTH, CANVAS_HEIGHT } from '../config/constants';
import { getUnitStats } from '../combat/stats';
import { CHARACTER_IMAGES } from '../assets/registry';
import { inventory } from '../state/inventory';
import type { OwnedTurby } from '../state/inventory';
import { withIGa } from '../utils/korean';

interface BattleUnit {
  side: 'party' | 'wild';
  characterCode: string;
  name: string;
  col: number;
  row: number;
  hp: number;
  maxHp: number;
  ap: number;
  maxAp: number;
  attack: number;
  defense: number;
  stunned: boolean;
  sprite: Phaser.GameObjects.Container;
  hpText: Phaser.GameObjects.Text;
  selectRing?: Phaser.GameObjects.Arc;
}

interface BattleInitData {
  wildCharacterCode: string;
  spawnIndex: number;
  capturedIndices: number[];
  removedIndices: number[];
  partyTurbys: OwnedTurby[]; // 3.3: PartySelectScene에서 고른 최대 5마리
}

const GRID_W = BATTLE_GRID_COLS * BATTLE_TILE_SIZE; // 960
const GRID_H = BATTLE_GRID_ROWS * BATTLE_TILE_SIZE; // 640
const OFFSET_X = (CANVAS_WIDTH - GRID_W) / 2;
const OFFSET_Y = (CANVAS_HEIGHT - GRID_H) / 2;
const PARTY_COL = 1; // 좌측 3열(0~2) 중 한 열에 세로로 배치

const CORNERS: Array<{ col: number; row: number }> = [
  { col: 0, row: 0 },
  { col: BATTLE_GRID_COLS - 1, row: 0 },
  { col: 0, row: BATTLE_GRID_ROWS - 1 },
  { col: BATTLE_GRID_COLS - 1, row: BATTLE_GRID_ROWS - 1 },
];

// 3.3/3.4/3.5.2 확정 규칙만으로 구성한 배틀그리드(7-6). 스킬/진형/지형지물(5.2-2, 미확정)은 아직 없음.
// 파티는 PartySelectScene에서 고른 1~5마리(3.3 "파티 최대인원=방인원"), 야생은 조우한 1마리.
export class BattleScene extends Phaser.Scene {
  private initData!: BattleInitData;
  private partyUnits: BattleUnit[] = [];
  private activeIndex = 0;
  private wild!: BattleUnit;
  private phase: 'player' | 'wild-turn' | 'over' = 'player';
  private moveHighlights: Phaser.GameObjects.Rectangle[] = [];
  private statusText!: Phaser.GameObjects.Text;

  constructor() {
    super('Battle');
  }

  init(data: BattleInitData) {
    this.initData = data;
    this.phase = 'player';
    this.moveHighlights = [];
    this.partyUnits = [];
    this.activeIndex = 0;
  }

  preload() {
    for (const [code, url] of Object.entries(CHARACTER_IMAGES)) {
      if (!this.textures.exists(`turby-${code}`)) this.load.image(`turby-${code}`, url);
    }
  }

  create() {
    this.cameras.main.setBackgroundColor('#1a1030');
    this.drawGrid();

    const rows = this.rowsForCount(this.initData.partyTurbys.length);
    this.partyUnits = this.initData.partyTurbys.map((owned, i) =>
      this.createUnit('party', owned.characterCode, owned.characterName, owned.stats, PARTY_COL, rows[i]),
    );
    this.wild = (() => {
      const stats = getUnitStats(this.initData.wildCharacterCode);
      return this.createUnit('wild', this.initData.wildCharacterCode, stats.name, stats, BATTLE_GRID_COLS - 2, 4);
    })();

    this.statusText = this.add
      .text(CANVAS_WIDTH / 2, 16, '', { fontSize: '16px', color: '#ffe9a8', backgroundColor: '#00000080', padding: { x: 8, y: 4 } })
      .setOrigin(0.5, 0)
      .setDepth(2000);

    this.add
      .text(CANVAS_WIDTH - 16, 16, '턴 종료', { fontSize: '16px', color: '#ffffff', backgroundColor: '#5a3a8a', padding: { x: 10, y: 6 } })
      .setOrigin(1, 0)
      .setDepth(2000)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.endPlayerTurn());

    this.selectFirstActionableUnit();
  }

  // 파티 인원수에 따라 8행 중 고르게 분산 배치(1마리면 기존과 동일하게 정중앙 4행)
  private rowsForCount(n: number): number[] {
    return Array.from({ length: n }, (_, i) => Math.min(BATTLE_GRID_ROWS - 1, Math.round((i + 0.5) * (BATTLE_GRID_ROWS / n))));
  }

  private drawGrid() {
    const g = this.add.graphics();
    g.fillStyle(0x241a3d, 1);
    g.fillRect(OFFSET_X, OFFSET_Y, GRID_W, GRID_H);
    g.lineStyle(1, 0x3d2f66, 1);
    for (let c = 0; c <= BATTLE_GRID_COLS; c++) g.lineBetween(OFFSET_X + c * BATTLE_TILE_SIZE, OFFSET_Y, OFFSET_X + c * BATTLE_TILE_SIZE, OFFSET_Y + GRID_H);
    for (let r = 0; r <= BATTLE_GRID_ROWS; r++) g.lineBetween(OFFSET_X, OFFSET_Y + r * BATTLE_TILE_SIZE, OFFSET_X + GRID_W, OFFSET_Y + r * BATTLE_TILE_SIZE);

    // 퇴각존(네 꼭짓점, 3.4/3.5.2 확정)
    for (const corner of CORNERS) {
      g.fillStyle(0xffe9a8, 0.18);
      g.fillRect(OFFSET_X + corner.col * BATTLE_TILE_SIZE, OFFSET_Y + corner.row * BATTLE_TILE_SIZE, BATTLE_TILE_SIZE, BATTLE_TILE_SIZE);
    }
  }

  private tileToWorld(col: number, row: number) {
    return { x: OFFSET_X + col * BATTLE_TILE_SIZE + BATTLE_TILE_SIZE / 2, y: OFFSET_Y + row * BATTLE_TILE_SIZE + BATTLE_TILE_SIZE / 2 };
  }

  private createUnit(
    side: 'party' | 'wild',
    characterCode: string,
    name: string,
    stats: { attack: number; defense: number; actionPower: number; maxHp: number },
    col: number,
    row: number,
  ): BattleUnit {
    const { x, y } = this.tileToWorld(col, row);
    const container = this.add.container(x, y);
    const hasImage = this.textures.exists(`turby-${characterCode}`);
    const body = hasImage
      ? this.add.image(0, 0, `turby-${characterCode}`).setDisplaySize(52, 52)
      : this.add.circle(0, 0, 24, side === 'party' ? 0xffd27f : 0x7fc8ff);
    const selectRing = this.add.circle(0, 0, 29).setStrokeStyle(3, 0x9fe58a, 0);
    const ring = this.add.circle(0, 0, 26).setStrokeStyle(3, side === 'party' ? 0x8a5a2b : 0x2d6fa3);
    container.add([selectRing, ring, body]);
    container.setDepth(10);

    const hpText = this.add
      .text(x, y + 34, `${name} HP ${stats.maxHp}/${stats.maxHp}`, { fontSize: '11px', color: '#ffffff', backgroundColor: '#00000090', padding: { x: 4, y: 2 } })
      .setOrigin(0.5, 0)
      .setDepth(10);

    const unit: BattleUnit = {
      side,
      characterCode,
      name,
      col,
      row,
      hp: stats.maxHp,
      maxHp: stats.maxHp,
      ap: stats.actionPower,
      maxAp: stats.actionPower,
      attack: stats.attack,
      defense: stats.defense,
      stunned: false,
      sprite: container,
      hpText,
      selectRing,
    };

    if (side === 'wild') {
      body.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.onWildClicked());
    } else {
      body.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.onPartyUnitClicked(unit));
    }

    return unit;
  }

  private get activeUnit(): BattleUnit | null {
    return this.partyUnits[this.activeIndex] ?? null;
  }

  private selectFirstActionableUnit() {
    const idx = this.partyUnits.findIndex((u) => !u.stunned && u.ap > 0);
    this.activeIndex = idx >= 0 ? idx : 0;
    this.refreshSelectionRings();
    this.updateStatusText();
    this.showMoveHighlights();
  }

  private refreshSelectionRings() {
    this.partyUnits.forEach((u, i) => u.selectRing?.setStrokeStyle(3, 0x9fe58a, i === this.activeIndex ? 1 : 0));
  }

  private updateStatusText() {
    if (this.phase !== 'player') return;
    const unit = this.activeUnit;
    this.statusText.setText(unit ? `${unit.name} 차례 — 이동할 칸/다른 유닛 선택, 더 할 게 없으면 자신을 눌러 다음 유닛으로` : '');
  }

  private onPartyUnitClicked(unit: BattleUnit) {
    if (this.phase !== 'player' || unit.stunned) return;
    const idx = this.partyUnits.indexOf(unit);
    if (idx < 0) return;

    // 이미 선택된(활성) 유닛을 다시 클릭 — 더 이동/공격할 게 없다는 의미로 보고, 확인 후 남은 기력을 소진해 다음 유닛으로 넘김
    if (idx === this.activeIndex) {
      if (unit.ap > 0) this.showExhaustConfirm(unit);
      return;
    }

    this.activeIndex = idx;
    this.refreshSelectionRings();
    this.updateStatusText();
    this.showMoveHighlights();
  }

  private showExhaustConfirm(unit: BattleUnit) {
    this.clearHighlights();

    const cx = CANVAS_WIDTH / 2;
    const cy = CANVAS_HEIGHT / 2;
    const layer: Phaser.GameObjects.GameObject[] = [];
    const close = () => layer.forEach((o) => o.destroy());

    layer.push(this.add.rectangle(cx, cy, CANVAS_WIDTH, CANVAS_HEIGHT, 0x000000, 0.5).setDepth(3999).setInteractive());
    layer.push(this.add.rectangle(cx, cy, 340, 160, 0x241a3d, 0.97).setStrokeStyle(3, 0x5a3a8a).setDepth(4000));
    layer.push(
      this.add
        .text(cx, cy - 40, `남은 기력 ${unit.ap}을(를) 모두 소진하고\n다음 유닛으로 넘기시겠습니까?`, { fontSize: '14px', color: '#ffffff', align: 'center' })
        .setOrigin(0.5)
        .setDepth(4001),
    );

    const yesBtn = this.add
      .text(cx - 60, cy + 40, '예', { fontSize: '16px', color: '#ffffff', backgroundColor: '#4a7a3a', padding: { x: 20, y: 8 } })
      .setOrigin(0.5)
      .setDepth(4001)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => {
        close();
        unit.ap = 0; // 확인 시 해당 턴의 기력을 다 사용한 것으로 간주
        this.afterAction();
      });
    const noBtn = this.add
      .text(cx + 60, cy + 40, '아니오', { fontSize: '16px', color: '#ffffff', backgroundColor: '#5a3a8a', padding: { x: 20, y: 8 } })
      .setOrigin(0.5)
      .setDepth(4001)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => {
        close();
        this.showMoveHighlights();
      });
    layer.push(yesBtn, noBtn);
  }

  private clearHighlights() {
    this.moveHighlights.forEach((h) => h.destroy());
    this.moveHighlights = [];
  }

  private isTileOccupied(col: number, row: number, exclude: BattleUnit): boolean {
    if (this.wild.col === col && this.wild.row === row && !this.wild.stunned) return true;
    return this.partyUnits.some((u) => u !== exclude && !u.stunned && u.col === col && u.row === row);
  }

  private showMoveHighlights() {
    this.clearHighlights();
    const unit = this.activeUnit;
    if (this.phase !== 'player' || !unit || unit.ap <= 0 || unit.stunned) return;

    for (let col = 0; col < BATTLE_GRID_COLS; col++) {
      for (let row = 0; row < BATTLE_GRID_ROWS; row++) {
        const dist = Math.abs(col - unit.col) + Math.abs(row - unit.row);
        if (dist === 0 || dist > unit.ap) continue;
        if (this.isTileOccupied(col, row, unit)) continue;
        const { x, y } = this.tileToWorld(col, row);
        const rect = this.add
          .rectangle(x, y, BATTLE_TILE_SIZE - 6, BATTLE_TILE_SIZE - 6, 0x9fe58a, 0.22)
          .setStrokeStyle(2, 0x9fe58a, 0.6)
          .setInteractive({ useHandCursor: true })
          .on('pointerdown', () => this.onTileClicked(col, row, dist));
        this.moveHighlights.push(rect);
      }
    }
  }

  private onTileClicked(col: number, row: number, cost: number) {
    const unit = this.activeUnit;
    if (this.phase !== 'player' || !unit || unit.ap < cost) return;
    unit.col = col;
    unit.row = row;
    unit.ap -= cost;
    const { x, y } = this.tileToWorld(col, row);
    unit.sprite.setPosition(x, y);
    unit.hpText.setPosition(x, y + 34);

    if (this.checkRetreat(unit)) return;
    this.afterAction();
  }

  private isAdjacent(a: BattleUnit, b: BattleUnit) {
    return Math.abs(a.col - b.col) + Math.abs(a.row - b.row) === 1;
  }

  private onWildClicked() {
    const unit = this.activeUnit;
    if (this.phase !== 'player' || !unit || unit.ap < 1 || this.wild.stunned) return;
    if (!this.isAdjacent(unit, this.wild)) return;
    unit.ap -= 1;
    this.applyDamage(unit, this.wild);
    if (this.phase === 'player') this.afterAction();
  }

  // 행동 후: 현재 유닛 AP 남았으면 그대로 유지, 없으면 다음 가용 유닛으로 자동 전환, 전원 소진 시 턴 종료
  private afterAction() {
    const unit = this.activeUnit;
    if (unit && unit.ap > 0) {
      this.showMoveHighlights();
      return;
    }
    const nextIdx = this.partyUnits.findIndex((u) => !u.stunned && u.ap > 0);
    if (nextIdx < 0) {
      this.endPlayerTurn();
      return;
    }
    this.activeIndex = nextIdx;
    this.refreshSelectionRings();
    this.updateStatusText();
    this.showMoveHighlights();
  }

  private applyDamage(attacker: BattleUnit, defender: BattleUnit) {
    const dmg = Math.max(1, attacker.attack - Math.floor(defender.defense / 2));
    defender.hp = Math.max(0, defender.hp - dmg);
    defender.hpText.setText(`${defender.name} HP ${defender.hp}/${defender.maxHp}${defender.hp <= 0 ? ' (기절)' : ''}`);
    if (defender.hp <= 0) {
      defender.stunned = true;
      defender.selectRing?.setStrokeStyle(3, 0x9fe58a, 0);
      if (defender.side === 'wild') {
        this.endBattle('win');
      } else if (this.partyUnits.every((u) => u.stunned)) {
        this.endBattle('lose');
      }
    }
  }

  private checkRetreat(unit: BattleUnit): boolean {
    const atCorner = CORNERS.some((c) => c.col === unit.col && c.row === unit.row);
    if (atCorner) {
      this.endBattle('draw');
      return true;
    }
    return false;
  }

  private endPlayerTurn() {
    if (this.phase !== 'player') return;
    this.phase = 'wild-turn';
    this.clearHighlights();
    this.statusText.setText('야생 터비 차례...');
    this.time.delayedCall(500, () => this.runWildTurn());
  }

  private nearestPartyTarget(): BattleUnit | null {
    const alive = this.partyUnits.filter((u) => !u.stunned);
    if (alive.length === 0) return null;
    return alive.reduce((closest, u) => {
      const d = Math.abs(u.col - this.wild.col) + Math.abs(u.row - this.wild.row);
      const closestD = Math.abs(closest.col - this.wild.col) + Math.abs(closest.row - this.wild.row);
      return d < closestD ? u : closest;
    });
  }

  private runWildTurn() {
    if (this.phase !== 'wild-turn') return;
    this.wild.ap = this.wild.maxAp;

    const step = () => {
      if (this.wild.ap <= 0 || this.wild.stunned) {
        this.startPlayerTurn();
        return;
      }
      const target = this.nearestPartyTarget();
      if (!target) return; // endBattle('lose')가 이미 처리했어야 함

      if (this.isAdjacent(this.wild, target)) {
        this.wild.ap -= 1;
        this.applyDamage(this.wild, target);
        if (this.phase !== 'wild-turn') return;
        this.time.delayedCall(400, step);
        return;
      }
      // 가장 가까운 파티원 쪽으로 1칸 이동(장애물/지형지물 없음, 5.2-2 확정 전 단순 이동)
      const dCol = Math.sign(target.col - this.wild.col);
      const dRow = Math.sign(target.row - this.wild.row);
      const nextCol = dCol !== 0 ? this.wild.col + dCol : this.wild.col;
      const nextRow = dCol === 0 && dRow !== 0 ? this.wild.row + dRow : this.wild.row;
      const blocked = this.partyUnits.some((u) => !u.stunned && u.col === nextCol && u.row === nextRow);
      if (!blocked) {
        this.wild.col = nextCol;
        this.wild.row = nextRow;
        const { x, y } = this.tileToWorld(nextCol, nextRow);
        this.wild.sprite.setPosition(x, y);
        this.wild.hpText.setPosition(x, y + 34);
        if (this.checkRetreat(this.wild)) return;
      }
      this.wild.ap -= 1;
      this.time.delayedCall(400, step);
    };

    step();
  }

  private startPlayerTurn() {
    if (this.phase === 'over') return;
    this.phase = 'player';
    this.partyUnits.forEach((u) => {
      if (!u.stunned) u.ap = u.maxAp;
    });
    this.selectFirstActionableUnit();
  }

  private endBattle(result: 'win' | 'lose' | 'draw') {
    this.phase = 'over';
    this.clearHighlights();

    if (result === 'win') inventory.add(this.wild.characterCode); // 3.2: 포획 성공 시 보유 터비로 편입

    // 유저 피드백(2026-09-16): 승리 시 "돌아가기"만 있으면 실패처럼 느껴짐 — 결과별로 톤/이미지를 다르게 보여줌
    const RESULT_STYLE = {
      win: { title: '포획 성공!', titleColor: '#ffe9a8', border: 0xffcf6b, sub: `${withIGa(this.wild.name)} 가방에 들어왔어요`, btnLabel: '가방에 넣고 돌아가기', btnColor: 0x4a7a3a },
      lose: { title: '야생 터비가 도망쳤어요', titleColor: '#ffb199', border: 0x8a4a3a, sub: '다음 기회에 다시 도전해보세요', btnLabel: '맵으로 돌아가기', btnColor: 0x5a3a8a },
      draw: { title: '무승부 — 퇴각', titleColor: '#cfe8ff', border: 0x6b8fbf, sub: '같은 자리에서 다시 도전할 수 있어요', btnLabel: '맵으로 돌아가기', btnColor: 0x5a3a8a },
    }[result];

    this.statusText.setText('');

    const panelW = 420;
    const panelH = 340;
    const cx = CANVAS_WIDTH / 2;
    const cy = CANVAS_HEIGHT / 2;

    this.add.rectangle(cx, cy, CANVAS_WIDTH, CANVAS_HEIGHT, 0x000000, 0.65).setDepth(2999);
    this.add.rectangle(cx, cy, panelW, panelH, 0x241a3d, 0.97).setStrokeStyle(3, RESULT_STYLE.border).setDepth(3000);

    this.add
      .text(cx, cy - panelH / 2 + 40, RESULT_STYLE.title, { fontSize: '24px', color: RESULT_STYLE.titleColor, fontStyle: 'bold' })
      .setOrigin(0.5)
      .setDepth(3001);

    const hasImage = this.textures.exists(`turby-${this.wild.characterCode}`);
    if (hasImage) {
      this.add.image(cx, cy - 30, `turby-${this.wild.characterCode}`).setDisplaySize(110, 110).setDepth(3001);
    } else {
      this.add.circle(cx, cy - 30, 55, result === 'win' ? 0xffd27f : 0x7fc8ff).setDepth(3001);
    }

    this.add.text(cx, cy + 50, RESULT_STYLE.sub, { fontSize: '14px', color: '#cccccc' }).setOrigin(0.5).setDepth(3001);

    this.add
      .text(cx, cy + panelH / 2 - 40, RESULT_STYLE.btnLabel, { fontSize: '18px', color: '#ffffff', backgroundColor: `#${RESULT_STYLE.btnColor.toString(16)}`, padding: { x: 14, y: 8 } })
      .setOrigin(0.5)
      .setDepth(3001)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => {
        // 3.4: 승리=포획(재등장 안 함) / 패배=야생 도주(포획은 아니지만 재등장 안 함) / 무승부(퇴각)=재도전 가능하도록 마커 유지
        const capturedIndices = result === 'win' ? [...this.initData.capturedIndices, this.initData.spawnIndex] : this.initData.capturedIndices;
        const removedIndices = result === 'draw' ? this.initData.removedIndices : [...this.initData.removedIndices, this.initData.spawnIndex];
        this.scene.start('Map', { capturedIndices, removedIndices });
      });
  }
}
