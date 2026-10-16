import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import type { AdminRequest } from './admin.guard';
import { AdminService } from './admin.service';

// 관리자 백오피스(2026-09-29, docs/dev/admin_backoffice.md) — 전부 AdminGuard(role='admin') 뒤에 있다.
@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('kirby/players')
  searchPlayers(@Query('q') q: unknown) {
    return this.admin.searchKirbyPlayers(q);
  }

  @Get('kirby/players/:playerId')
  getPlayer(@Param('playerId') playerId: string) {
    return this.admin.getKirbyPlayer(playerId);
  }

  @Get('kirby/characters')
  listCharacters() {
    return this.admin.listKirbyCharacters();
  }

  // {characterId, count?(1~20)}
  @Post('kirby/players/:playerId/instances')
  addKirbies(@Req() req: AdminRequest, @Param('playerId') playerId: string, @Body('characterId') characterId: unknown, @Body('count') count: unknown) {
    return this.admin.addKirbies(req.adminAccountId!, playerId, characterId, count);
  }

  @Delete('kirby/players/:playerId/instances/:instanceId')
  removeKirby(@Req() req: AdminRequest, @Param('playerId') playerId: string, @Param('instanceId') instanceId: string) {
    return this.admin.removeKirby(req.adminAccountId!, playerId, instanceId);
  }

  // {mode: 'set'|'add', amount}
  @Post('kirby/players/:playerId/gold')
  adjustGold(@Req() req: AdminRequest, @Param('playerId') playerId: string, @Body('mode') mode: unknown, @Body('amount') amount: unknown) {
    return this.admin.adjustGold(req.adminAccountId!, playerId, mode, amount);
  }

  // 스폿 설정(가중치·등장 여부·등장 기간) + 지금 확률
  @Get('kirby/spawn')
  listSpawn() {
    return this.admin.listSpawnSettings();
  }

  // {changes: [{characterId, weight?, spawnEnabled?, spawnStartsAt?, spawnEndsAt?}]}
  @Put('kirby/spawn')
  updateSpawn(@Req() req: AdminRequest, @Body('changes') changes: unknown) {
    return this.admin.updateSpawnSettings(req.adminAccountId!, changes);
  }

  @Get('ad-games/merge-defense/accounts')
  searchMergeDefenseAccounts(@Query('q') q: unknown) {
    return this.admin.searchMergeDefenseAccounts(q);
  }

  @Get('ad-games/merge-defense/accounts/:accountId')
  getMergeDefenseProfile(@Param('accountId') accountId: string) {
    return this.admin.getMergeDefenseProfile(accountId);
  }

  @Put('ad-games/merge-defense/accounts/:accountId')
  updateMergeDefenseProfile(@Req() req: AdminRequest, @Param('accountId') accountId: string, @Body() body: unknown) {
    return this.admin.updateMergeDefenseProfile(req.adminAccountId!, accountId, body);
  }

  @Get('ad-games/my-room-dungeon/accounts')
  searchMyRoomDungeonAccounts(@Query('q') q: unknown) {
    return this.admin.searchMyRoomDungeonAccounts(q);
  }

  @Get('ad-games/my-room-dungeon/accounts/:accountId')
  getMyRoomDungeonProfile(@Param('accountId') accountId: string) {
    return this.admin.getMyRoomDungeonProfile(accountId);
  }

  @Put('ad-games/my-room-dungeon/accounts/:accountId')
  updateMyRoomDungeonProfile(@Req() req: AdminRequest, @Param('accountId') accountId: string, @Body() body: unknown) {
    return this.admin.updateMyRoomDungeonProfile(req.adminAccountId!, accountId, body);
  }

  @Delete('ad-games/my-room-dungeon/accounts/:accountId')
  deleteMyRoomDungeonProfile(@Req() req: AdminRequest, @Param('accountId') accountId: string) {
    return this.admin.deleteMyRoomDungeonProfile(req.adminAccountId!, accountId);
  }

  // ?limit=50&targetId=
  @Get('logs')
  listLogs(@Query('limit') limit: unknown, @Query('targetId') targetId: unknown) {
    return this.admin.listLogs(limit, targetId);
  }
}
