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
}
