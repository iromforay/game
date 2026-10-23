import { Module } from '@nestjs/common';
import { ColorBlastersGateway } from './color-blasters.gateway';
import { ColorBlastersService } from './color-blasters.service';

@Module({ providers: [ColorBlastersService, ColorBlastersGateway] })
export class ColorBlastersModule {}
