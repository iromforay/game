import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

// 잠정 수치(이동 속도 상한, 재접속 유예 등)는 코드에 박지 않고 game_setting(DB)에서 읽는다.
@Injectable()
export class SettingsService implements OnModuleInit {
  private values = new Map<string, unknown>();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.reload();
  }

  async reload() {
    const rows = await this.prisma.game_setting.findMany();
    this.values = new Map(rows.map((r) => [r.setting_key, JSON.parse(r.value_json) as unknown]));
  }

  number(key: string): number {
    const v = this.values.get(key);
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`game_setting "${key}" is missing or not a number`);
    return v;
  }

  // 스토리 M1에서 추가한 설정은 SQL 적용 전에도 서버가 뜨도록 기본값을 받는다
  numberOr(key: string, fallback: number): number {
    const v = this.values.get(key);
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  }

  flag(key: string, fallback: boolean): boolean {
    const v = this.values.get(key);
    return typeof v === 'boolean' ? v : fallback;
  }
}
