import { OnModuleDestroy } from '@nestjs/common';
import { ConnectedSocket, MessageBody, OnGatewayDisconnect, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { SWEET_SHOP_EVENTS, type SweetShopRealtimePlayer } from 'sweet-shop-contracts';
import { Server, Socket } from 'socket.io';
import { SweetShopService } from './sweet-shop.service';

const disabled = () => ({ ok: false, code: 'MULTIPLAYER_DISABLED', message: '달콤상점 멀티플레이는 아직 비활성화되어 있습니다.' });

@WebSocketGateway({ cors: { origin: '*' } })
export class SweetShopGateway implements OnGatewayDisconnect, OnModuleDestroy {
  @WebSocketServer() private server!: Server;
  private readonly realtime = new Map<string, SweetShopRealtimePlayer>();
  private readonly chatWindows = new Map<string, number[]>();
  private readonly stopNpcPurchaseListener: () => void;
  constructor(private readonly sweetShop: SweetShopService) {
    this.stopNpcPurchaseListener = this.sweetShop.onNpcPurchase((event) => {
      if (!this.server) return;
      this.server.to(this.room(event.profileId)).emit(SWEET_SHOP_EVENTS.cafePurchaseNotice, event);
      this.server.to(this.room(event.profileId)).emit(SWEET_SHOP_EVENTS.cafeDisplayChanged, { profileId: event.profileId });
      if (event.cafeClosed) this.server.emit(SWEET_SHOP_EVENTS.cafeOpenState, { profileId: event.profileId, isOpen: false });
    });
  }

  onModuleDestroy() { this.stopNpcPurchaseListener(); }

  private enabled() { return process.env.SWEET_SHOP_MULTIPLAYER_ENABLED === 'true'; }

  @SubscribeMessage(SWEET_SHOP_EVENTS.loadCafe)
  async loadCafe(@MessageBody() body: { token?: unknown }) {
    if (!this.enabled()) return disabled();
    return this.safe(() => this.sweetShop.loadCafe(body?.token, body));
  }

  @SubscribeMessage(SWEET_SHOP_EVENTS.orderIngredients) orderIngredients(@MessageBody() body: any) { return this.run('orderIngredients', body); }
  @SubscribeMessage(SWEET_SHOP_EVENTS.receiveDelivery) receiveDelivery(@MessageBody() body: any) { return this.run('receiveDelivery', body); }
  @SubscribeMessage(SWEET_SHOP_EVENTS.startCooking) startCooking(@MessageBody() body: any) { return this.run('startCooking', body); }
  @SubscribeMessage(SWEET_SHOP_EVENTS.receiveCooking) receiveCooking(@MessageBody() body: any) { return this.run('receiveCooking', body); }
  @SubscribeMessage(SWEET_SHOP_EVENTS.completeFirstCookingTutorial)
  async completeFirstCookingTutorial(@MessageBody() body: { token?: unknown }) {
    if (!this.enabled()) return disabled();
    return { ok: true, data: await this.sweetShop.completeFirstCookingTutorial(body?.token, body) };
  }
  @SubscribeMessage(SWEET_SHOP_EVENTS.createListing) createListing(@MessageBody() body: any) { return this.runAndNotifyStreet('createListing', body); }
  @SubscribeMessage(SWEET_SHOP_EVENTS.updateListing) updateListing(@MessageBody() body: any) { return this.runAndNotifyStreet('updateListing', body); }
  @SubscribeMessage(SWEET_SHOP_EVENTS.removeListing) removeListing(@MessageBody() body: any) { return this.runAndNotifyStreet('removeListing', body); }
  @SubscribeMessage(SWEET_SHOP_EVENTS.visitCafe) visitCafe(@MessageBody() body: any) { return this.run('visitCafe', body); }
  @SubscribeMessage(SWEET_SHOP_EVENTS.listCafeStreet) listCafeStreet(@MessageBody() body: any) { return this.run('listCafeStreet', body); }
  @SubscribeMessage(SWEET_SHOP_EVENTS.buyDessert) buyDessert(@MessageBody() body: any) { return this.runAndNotifyStreet('buyDessert', body); }
  @SubscribeMessage(SWEET_SHOP_EVENTS.eatDessert) eatDessert(@MessageBody() body: any) { return this.run('eatDessert', body); }
  @SubscribeMessage(SWEET_SHOP_EVENTS.createGuestbook) createGuestbook(@MessageBody() body: any) { return this.runAndNotifyStreet('createGuestbook', body); }
  @SubscribeMessage(SWEET_SHOP_EVENTS.replyGuestbook) replyGuestbook(@MessageBody() body: any) { return this.runAndNotifyStreet('replyGuestbook', body); }
  @SubscribeMessage(SWEET_SHOP_EVENTS.activateAdvertisement) activateAdvertisement(@MessageBody() body: any) { return this.run('activateAdvertisement', body); }
  @SubscribeMessage(SWEET_SHOP_EVENTS.listFriends) listFriends(@MessageBody() body: any) { return this.run('listFriends', body); }
  @SubscribeMessage(SWEET_SHOP_EVENTS.addFriend) addFriend(@MessageBody() body: any) { return this.run('addFriend', body); }
  @SubscribeMessage(SWEET_SHOP_EVENTS.removeFriend) removeFriend(@MessageBody() body: any) { return this.run('removeFriend', body); }
  @SubscribeMessage(SWEET_SHOP_EVENTS.blockProfile)
  async blockProfile(@MessageBody() body: any) {
    const result: any = await this.run('blockProfile', body);
    if (!result?.ok) return result;
    const blocker = await this.sweetShop.realtimeIdentity(body?.token, body?.guestId);
    const blockerId = blocker.profileId.toString(); const targetId = String(result.data.profileId);
    for (const [socketId, player] of this.realtime) {
      const sharedCafe = (player.profileId === targetId && player.cafeProfileId === blockerId) || (player.profileId === blockerId && player.cafeProfileId === targetId);
      if (!sharedCafe) continue;
      const socket = this.server.sockets.sockets.get(socketId); if (!socket) continue;
      socket.emit(SWEET_SHOP_EVENTS.cafeAccessRevoked, { profileId: player.cafeProfileId, message: '차단으로 카페 연결이 종료되었습니다.' });
      await this.leaveRoom(socket);
    }
    return result;
  }
  @SubscribeMessage(SWEET_SHOP_EVENTS.listBlockedProfiles) listBlockedProfiles(@MessageBody() body: any) { return this.run('listBlockedProfiles', body); }
  @SubscribeMessage(SWEET_SHOP_EVENTS.unblockProfile) unblockProfile(@MessageBody() body: any) { return this.run('unblockProfile', body); }
  @SubscribeMessage(SWEET_SHOP_EVENTS.reportProfile) reportProfile(@MessageBody() body: any) { return this.run('reportProfile', body); }

  @SubscribeMessage(SWEET_SHOP_EVENTS.cafeChatSend)
  async cafeChat(@MessageBody() body: any, @ConnectedSocket() client: Socket) {
    const current = this.realtime.get(client.id);
    if (!current) return { ok: false, code: 'CAFE_ROOM_NOT_ENTERED', message: '카페 채널에 입장하지 않았습니다.' };
    const now = Date.now(); const recent = (this.chatWindows.get(client.id) ?? []).filter((time) => now - time < 10000);
    if (recent.length >= 5) return { ok: false, code: 'CHAT_RATE_LIMIT', message: '채팅이 너무 빠릅니다. 잠시 후 다시 시도해주세요.' };
    const message = String(body?.message ?? '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 80);
    if (!message) return { ok: false, code: 'EMPTY_CHAT_MESSAGE', message: '메시지를 입력해주세요.' };
    recent.push(now); this.chatWindows.set(client.id, recent);
    const room = this.room(current.cafeProfileId);
    const participants = await this.server.in(room).fetchSockets();
    await this.sweetShop.saveChatMessage(BigInt(current.cafeProfileId), BigInt(current.profileId), current.nickname, message);
    this.server.to(room).emit(SWEET_SHOP_EVENTS.cafeChatMessage, { profileId: current.profileId, cafeProfileId: current.cafeProfileId, nickname: current.nickname, message, sentAt: new Date().toISOString() });
    return { ok: true, data: { cafeProfileId: current.cafeProfileId, participantCount: participants.length } };
  }

  @SubscribeMessage(SWEET_SHOP_EVENTS.enterRealtimeCafe)
  async enterRealtimeCafe(@MessageBody() body: any, @ConnectedSocket() client: Socket) {
    if (!this.enabled()) return disabled();
    const identity = await this.sweetShop.realtimeIdentity(body?.token, body?.guestId);
    const cafeProfileId = body?.cafeProfileId ? String(body.cafeProfileId) : identity.profileId.toString();
    if (!/^\d+$/.test(cafeProfileId)) return { ok: false, code: 'INVALID_CAFE', message: '카페를 찾지 못했습니다.' };
    if (identity.profileId.toString() !== cafeProfileId && await this.sweetShop.isInteractionBlocked(identity.profileId, BigInt(cafeProfileId))) return { ok: false, code: 'PROFILE_BLOCKED', message: '방문할 수 없는 카페입니다.' };
    const player = await this.enterRoom(client, identity.profileId.toString(), identity.nickname, cafeProfileId, Number(body?.x), Number(body?.y));
    const players = [...this.realtime.values()].filter((item) => item.cafeProfileId === cafeProfileId && item.profileId !== player.profileId);
    const chatMessages = await this.sweetShop.listChatMessages(BigInt(cafeProfileId));
    return { ok: true, data: { players, chatMessages } };
  }

  @SubscribeMessage(SWEET_SHOP_EVENTS.leaveRealtimeCafe)
  async leaveRealtimeCafe(@ConnectedSocket() client: Socket) { await this.leaveRoom(client); return { ok: true, data: {} }; }

  @SubscribeMessage(SWEET_SHOP_EVENTS.moveRealtimeCafe)
  moveRealtimeCafe(@MessageBody() body: any, @ConnectedSocket() client: Socket) {
    const current = this.realtime.get(client.id); if (!current) return;
    let x = Number(body?.x); let y = Number(body?.y); if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (current.isOwner) { x = Math.max(72, Math.min(1224, x)); y = Math.max(72, Math.min(1656, y)); }
    // 손님은 주방으로 들어갈 수 없고 홀(판매대·게시판·탁자·출입문) 안에서만 이동한다.
    else { x = Math.max(144, Math.min(1152, x)); y = Math.max(972, Math.min(1584, y)); }
    const player = { ...current, x, y }; this.realtime.set(client.id, player);
    client.to(this.room(player.cafeProfileId)).emit(SWEET_SHOP_EVENTS.realtimePresence, { type: 'moved', players: [], player });
  }

  handleDisconnect(client: Socket) { this.chatWindows.delete(client.id); void this.leaveRoom(client); }

  private room(cafeProfileId: string) { return `sweet-shop:cafe:${cafeProfileId}`; }
  private async enterRoom(client: Socket, profileId: string, nickname: string, cafeProfileId: string, rawX: number, rawY: number) {
    await this.leaveRoom(client);
    const isOwner = profileId === cafeProfileId;
    const x = isOwner ? Math.max(72, Math.min(1224, Number.isFinite(rawX) ? rawX : 684)) : 684;
    const y = isOwner ? Math.max(72, Math.min(1656, Number.isFinite(rawY) ? rawY : 1044)) : 1476;
    const player = { profileId, nickname, cafeProfileId, isOwner, x, y };
    this.realtime.set(client.id, player); await client.join(this.room(cafeProfileId));
    client.to(this.room(cafeProfileId)).emit(SWEET_SHOP_EVENTS.realtimePresence, { type: 'joined', players: [], player });
    return player;
  }
  private async leaveRoom(client: Socket) {
    const player = this.realtime.get(client.id); if (!player) return;
    this.realtime.delete(client.id); await client.leave(this.room(player.cafeProfileId));
    this.server.to(this.room(player.cafeProfileId)).emit(SWEET_SHOP_EVENTS.realtimePresence, { type: 'left', players: [], profileId: player.profileId });
  }

  private async run(method: keyof SweetShopService, body: any) {
    if (!this.enabled()) return disabled();
    return this.safe(() => (this.sweetShop[method] as any).call(this.sweetShop, body?.token, body), false);
  }

  private async runAndNotifyStreet(method: keyof SweetShopService, body: any) {
    const result: any = await this.run(method, body);
    const profileId = result?.data?.profileId;
    if (result?.ok && profileId) {
      this.server.to(this.room(String(profileId))).emit(SWEET_SHOP_EVENTS.cafeDisplayChanged, { profileId: String(profileId) });
      if (method === 'buyDessert') this.server.to(this.room(String(profileId))).emit(SWEET_SHOP_EVENTS.cafePurchaseNotice, { profileId: String(profileId), dessertName: result.data.dessertName, totalPrice: result.data.totalPrice });
      if (result.data.cafeOpened) this.server.emit(SWEET_SHOP_EVENTS.cafeOpenState, { profileId: String(profileId), isOpen: true });
      if (result.data.cafeClosed) this.server.emit(SWEET_SHOP_EVENTS.cafeOpenState, { profileId: String(profileId), isOpen: false });
    }
    return result;
  }

  private async safe<T>(action: () => Promise<T>, wrap = true) {
    try {
      const result = await action();
      return wrap ? { ok: true, data: result } : result;
    } catch (error: any) {
      const response = typeof error?.getResponse === 'function' ? error.getResponse() : null;
      const message = typeof response === 'object' && response?.message
        ? response.message
        : '달콤상점 서버 처리 중 오류가 발생했습니다.';
      const code = typeof response === 'object' && response?.code ? response.code : 'SWEET_SHOP_SERVER_ERROR';
      return { ok: false, code, message };
    }
  }
}
