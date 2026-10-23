import { Module } from '@nestjs/common';
import { RoomsModule } from './rooms/rooms.module';
import { ColorBlastersModule } from './color-blasters/color-blasters.module';

@Module({
  imports: [RoomsModule, ColorBlastersModule],
})
export class AppModule {}
