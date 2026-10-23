import { Module } from '@nestjs/common';
import { ColorBlastersModule } from './color-blasters/color-blasters.module';

@Module({
  imports: [ColorBlastersModule],
})
export class ColorBlastersAppModule {}
