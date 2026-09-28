import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { CollectionService } from './collection.service';

@Controller('collection')
export class CollectionController {
  constructor(private readonly collection: CollectionService) {}

  // device_uuid는 플레이어 식별자라 URL(쿼리)로 받지 않고 본문으로 받는다.
  @Post('turby')
  @HttpCode(200)
  turby(@Body('deviceUuid') deviceUuid: unknown) {
    return this.collection.turby(deviceUuid);
  }
}
