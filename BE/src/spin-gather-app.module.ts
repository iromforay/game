import { Module } from '@nestjs/common';
import { AccountModule } from './account/account.module';
import { PrismaService } from './scoreboard/prisma.service';
import { SpinGatherController } from './spin-gather/spin-gather.controller';
import { SpinGatherService } from './spin-gather/spin-gather.service';

@Module({ imports: [AccountModule], controllers: [SpinGatherController], providers: [PrismaService, SpinGatherService] })
export class SpinGatherAppModule {}
