// 스토리 서비스 목 테스트용 메모리 Prisma. 서비스가 실제로 쓰는 호출 형태만 지원한다.
// - unique 제약 위반은 Prisma와 같은 code 'P2002'로 던진다.
// - $transaction 안에서 예외가 나면 그 트랜잭션이 한 변경을 모두 되돌린다.
// - 매 호출마다 한 번 양보해서 Promise.all 동시 요청이 실제로 섞이게 한다.

type Row = Record<string, unknown>;
type Undo = () => void;

interface TableDef {
  uniques: string[][];
  compound?: Record<string, string[]>; // Prisma 복합 키 이름 → 컬럼들
  defaults?: () => Row;
  autoId?: boolean;
}

const TABLES: Record<string, TableDef> = {
  player: { uniques: [['id'], ['device_uuid'], ['session_token']], autoId: true, defaults: () => ({ session_token: null, tare_balance: 0 }) },
  player_story_progress: {
    uniques: [['player_id'], ['story_nubi_turby_instance_id']],
    defaults: () => ({ checkpoint: 'OPENING_NOT_STARTED', story_nubi_turby_instance_id: null, nubi_growth_stage: 0, origin: 'new' }),
  },
  player_story_event: { uniques: [['player_id', 'event_id']], autoId: true, defaults: () => ({ source: 'story', completed_at: new Date() }) },
  player_story_objective_progress: { uniques: [['player_id', 'objective_key', 'object_id']], autoId: true },
  item_definition: { uniques: [['code']], autoId: true, defaults: () => ({ max_stack: 1, story_slot: null, equip_slot: null, atk_bonus: 0, def_bonus: 0, ap_bonus: 0, hp_bonus: 0, description: null }) },
  player_item: {
    uniques: [['player_id', 'item_definition_id']],
    compound: { player_id_item_definition_id: ['player_id', 'item_definition_id'] },
    defaults: () => ({ quantity: 0, first_acquired_at: null, last_acquired_at: null, is_new: false, is_locked: false, used_at: null }),
  },
  player_item_overflow: { uniques: [['player_id', 'source_key']], autoId: true, defaults: () => ({ claimed_at: null, expires_at: null, created_at: new Date() }) },
  turby_character: { uniques: [['code']], autoId: true },
  story_chapter: { uniques: [['chapter_order'], ['stage_code']] },
  stage_wild_spawn: { uniques: [['stage_code', 'spawn_index']] },
  turby_grade: { uniques: [['id']] },
  player_base_slot: { uniques: [['id']], autoId: true },
  turby_instance: {
    uniques: [['id']],
    autoId: true,
    defaults: () => ({ base_slot_id: null, is_story_companion: false, is_locked: false, created_at: new Date(), atk_bonus: 0, def_bonus: 0, ap_bonus: 0, hp_bonus: 0 }),
  },
  turby_equipment: {
    uniques: [['turby_instance_id', 'slot_key']],
    compound: { turby_instance_id_slot_key: ['turby_instance_id', 'slot_key'] },
    autoId: true,
  },
  // 실제 앱 통합 테스트: 설정(SettingsService가 기동 때 읽음)
  game_setting: { uniques: [['setting_key']] },
  // 일반 야생 전투 정산(회귀 테스트)
  coop_battle: { uniques: [['battle_key']], autoId: true, defaults: () => ({ created_at: new Date() }) },
  battle_result: {
    uniques: [['battle_id', 'player_id']],
    compound: { battle_id_player_id: ['battle_id', 'player_id'] },
    autoId: true,
    defaults: () => ({ opponent_player_id: null, reward_tare: 0, reward_exp: 0, reward_item_json: null, captured_turby_instance_id: null, created_at: new Date() }),
  },
};

export class UniqueViolation extends Error {
  code = 'P2002';
}

const tick = () => new Promise<void>((r) => setImmediate(r));
const same = (a: unknown, b: unknown) => (typeof a === 'bigint' || typeof b === 'bigint' ? String(a) === String(b) : a === b || (a == null && b == null));

export class FakeDb {
  tables: Record<string, Row[]> = Object.fromEntries(Object.keys(TABLES).map((t) => [t, []]));
  private nextId = 1000n;
  failOn: ((table: string, op: string, args: Row) => boolean) | null = null;

  seed(table: string, row: Row): Row {
    const def = TABLES[table];
    const full = { ...(def.defaults?.() ?? {}), ...row };
    if (def.autoId && full.id === undefined) full.id = this.newId(table);
    this.tables[table].push(full);
    return full;
  }

  rows(table: string, where: Row = {}) {
    return this.tables[table].filter((r) => this.matches(table, r, where));
  }

  client() {
    return this.makeClient(null) as never;
  }

  private newId(table: string): bigint | number {
    this.nextId += 1n;
    return table === 'item_definition' || table === 'turby_character' ? Number(this.nextId) : this.nextId;
  }

  private flattenWhere(table: string, where: Row): Row {
    const out: Row = {};
    for (const [k, v] of Object.entries(where ?? {})) {
      const cols = TABLES[table].compound?.[k];
      if (cols && v && typeof v === 'object') for (const c of cols) out[c] = (v as Row)[c];
      else out[k] = v;
    }
    return out;
  }

  private matches(table: string, row: Row, whereRaw: Row): boolean {
    const where = this.flattenWhere(table, whereRaw);
    return Object.entries(where).every(([k, cond]) => {
      if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
        const c = cond as Row;
        // 관계 필터(예: turby_equipment.where.turby_instance.owner_player_id) — 연결된 한 행이 조건을 만족하는지
        const rel = FakeDb.RELATIONS[table]?.[k];
        if (rel && !rel[3]) {
          const [target, fromKey, toKey] = rel;
          const linked = this.tables[target].find((x) => same(x[toKey], row[fromKey]));
          return !!linked && this.matches(target, linked, c);
        }
        if ('gte' in c) return (row[k] as number) >= (c.gte as number);
        if ('in' in c) return (c.in as unknown[]).some((x) => same(x, row[k]));
        if ('not' in c) return !same(row[k], c.not);
        if ('startsWith' in c) return typeof row[k] === 'string' && (row[k] as string).startsWith(c.startsWith as string);
        throw new Error(`fake-prisma: 지원하지 않는 조건 ${k}`);
      }
      return same(row[k], cond);
    });
  }

  private checkUnique(table: string, row: Row, except: Row | null) {
    for (const cols of TABLES[table].uniques) {
      if (cols.some((c) => row[c] === null || row[c] === undefined)) continue;
      const clash = this.tables[table].find((r) => r !== except && cols.every((c) => same(r[c], row[c])));
      if (clash) throw new UniqueViolation(`${table} unique(${cols.join(',')})`);
    }
  }

  private applyData(row: Row, data: Row) {
    for (const [k, v] of Object.entries(data)) {
      if (v !== null && typeof v === 'object' && !(v instanceof Date) && ('increment' in (v as Row) || 'decrement' in (v as Row))) {
        const d = v as { increment?: number; decrement?: number };
        row[k] = (row[k] as number) + (d.increment ?? 0) - (d.decrement ?? 0);
      } else row[k] = v;
    }
  }

  // 관계 조회(include) — 서비스가 쓰는 관계만: [대상 테이블, 이 행의 키, 대상 키, 여러 개 여부]
  private static RELATIONS: Record<string, Record<string, [string, string, string, boolean]>> = {
    player_item: { item_definition: ['item_definition', 'item_definition_id', 'id', false] },
    turby_instance: {
      turby_character: ['turby_character', 'character_id', 'id', false],
      player_base_slot: ['player_base_slot', 'base_slot_id', 'id', false],
      turby_equipment: ['turby_equipment', 'id', 'turby_instance_id', true],
    },
    turby_character: { turby_grade: ['turby_grade', 'grade_id', 'id', false] },
    turby_equipment: { item_definition: ['item_definition', 'item_definition_id', 'id', false], turby_instance: ['turby_instance', 'turby_instance_id', 'id', false] },
  };

  private include(table: string, row: Row, include: Row | undefined): Row {
    if (!include) return { ...row };
    const out = { ...row };
    for (const [rel, spec] of Object.entries(include)) {
      const r = FakeDb.RELATIONS[table]?.[rel];
      if (!r) continue;
      const [target, fromKey, toKey, many] = r;
      const nested = spec && typeof spec === 'object' ? ((spec as Row).include as Row | undefined) : undefined;
      const matches = this.tables[target].filter((x) => same(x[toKey], row[fromKey]) && row[fromKey] != null);
      out[rel] = many ? matches.map((m) => this.include(target, m, nested)) : matches[0] ? this.include(target, matches[0], nested) : null;
    }
    return out;
  }

  private makeClient(undo: Undo[] | null): Row {
    const db = this;
    const model = (table: string) => ({
      async findUnique(args: { where: Row; include?: Row }) {
        await tick();
        const r = db.rows(table, args.where)[0];
        return r ? db.include(table, r, args.include) : null;
      },
      async findUniqueOrThrow(args: { where: Row; include?: Row }) {
        await tick();
        const r = db.rows(table, args.where)[0];
        if (!r) throw new Error(`${table} not found`);
        return db.include(table, r, args.include);
      },
      async findFirst(args: { where: Row; orderBy?: Row[] }) {
        await tick();
        const list = db.rows(table, args.where).slice();
        for (const o of [...(args.orderBy ?? [])].reverse()) {
          const [k, dir] = Object.entries(o)[0];
          list.sort((a, b) => {
            const x = a[k] as number | bigint | Date;
            const y = b[k] as number | bigint | Date;
            const cmp = x < y ? -1 : x > y ? 1 : 0;
            return dir === 'desc' ? -cmp : cmp;
          });
        }
        return list[0] ? { ...list[0] } : null;
      },
      async findMany(args: { where?: Row; include?: Row } = {}) {
        await tick();
        return db.rows(table, args.where ?? {}).map((r) => db.include(table, r, args.include));
      },
      async count(args: { where?: Row } = {}) {
        await tick();
        return db.rows(table, args.where ?? {}).length;
      },
      async create(args: { data: Row }) {
        await tick();
        if (db.failOn?.(table, 'create', args.data)) throw new Error(`fake-prisma: 강제 실패 ${table}.create`);
        const def = TABLES[table];
        const row = { ...(def.defaults?.() ?? {}), ...args.data };
        if (def.autoId && row.id === undefined) row.id = db.newId(table);
        db.checkUnique(table, row, null);
        db.tables[table].push(row);
        undo?.push(() => {
          const i = db.tables[table].indexOf(row);
          if (i >= 0) db.tables[table].splice(i, 1);
        });
        return { ...row };
      },
      async update(args: { where: Row; data: Row }) {
        await tick();
        const row = db.rows(table, args.where)[0];
        if (!row) throw new Error(`${table} update: not found`);
        const before = { ...row };
        const next = { ...row };
        db.applyData(next, args.data);
        db.checkUnique(table, next, row);
        Object.assign(row, next);
        undo?.push(() => Object.assign(row, before));
        return { ...row };
      },
      async upsert(args: { where: Row; update: Row; create: Row }) {
        await tick();
        const row = db.rows(table, args.where)[0];
        if (row) {
          const before = { ...row };
          db.applyData(row, args.update);
          undo?.push(() => Object.assign(row, before));
          return { ...row };
        }
        const def = TABLES[table];
        const created = { ...(def.defaults?.() ?? {}), ...args.create };
        if (def.autoId && created.id === undefined) created.id = db.newId(table);
        db.checkUnique(table, created, null);
        db.tables[table].push(created);
        undo?.push(() => {
          const i = db.tables[table].indexOf(created);
          if (i >= 0) db.tables[table].splice(i, 1);
        });
        return { ...created };
      },
      async updateMany(args: { where: Row; data: Row }) {
        await tick();
        const list = db.rows(table, args.where);
        for (const row of list) {
          const before = { ...row };
          db.applyData(row, args.data);
          undo?.push(() => Object.assign(row, before));
        }
        return { count: list.length };
      },
      // 삭제(장비 해제 등). 트랜잭션이 실패하면 지운 행을 되돌린다
      async deleteMany(args: { where: Row }) {
        await tick();
        const list = db.rows(table, args.where);
        db.tables[table] = db.tables[table].filter((r) => !list.includes(r));
        undo?.push(() => db.tables[table].push(...list));
        return { count: list.length };
      },
      async delete(args: { where: Row }) {
        await tick();
        const row = db.rows(table, args.where)[0];
        if (!row) throw new Error(`${table} not found`);
        db.tables[table] = db.tables[table].filter((r) => r !== row);
        undo?.push(() => db.tables[table].push(row));
        return { ...row };
      },
    });
    const client: Row = Object.fromEntries(Object.keys(TABLES).map((t) => [t, model(t)]));
    // 태그드 템플릿 $queryRaw 흉내: 장비 장착의 "SELECT quantity FROM player_item WHERE player_id = ? AND item_definition_id = ? FOR UPDATE"만 지원
    client.$queryRaw = async (strings: TemplateStringsArray, ...values: unknown[]) => {
      await tick();
      const sql = strings.join('?');
      if (/FROM player_item WHERE player_id = \? AND item_definition_id = \?/.test(sql)) {
        return db.tables.player_item.filter((r) => same(r.player_id, values[0]) && same(r.item_definition_id, values[1])).map((r) => ({ quantity: r.quantity }));
      }
      throw new Error(`fake-prisma: 지원하지 않는 $queryRaw: ${sql}`);
    };
    client.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => {
      const log: Undo[] = [];
      try {
        return await fn(db.makeClient(log));
      } catch (err) {
        for (const u of log.reverse()) u();
        throw err;
      }
    };
    return client;
  }
}
