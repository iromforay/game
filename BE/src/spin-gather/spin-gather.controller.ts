import { Body, Controller, Get, Headers, Put } from '@nestjs/common';
import { SpinGatherService } from './spin-gather.service';

const bearer = (header?: string) => header?.startsWith('Bearer ') ? header.slice(7) : undefined;

@Controller('spin-gather')
export class SpinGatherController {
  constructor(private readonly service: SpinGatherService) {}

  @Get('profile')
  get(@Headers('authorization') auth?: string, @Headers('x-spin-gather-guest-id') guestId?: string) {
    return this.service.getProfile(bearer(auth), guestId);
  }

  @Put('profile')
  save(@Body() body: Record<string, unknown>, @Headers('authorization') auth?: string, @Headers('x-spin-gather-guest-id') guestId?: string) {
    return this.service.saveProfile(bearer(auth), guestId, body);
  }
}
