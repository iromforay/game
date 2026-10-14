import { MessageBody, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import { SWEET_SHOP_EVENTS } from 'sweet-shop-contracts';
import { SweetShopService } from './sweet-shop.service';

const disabled = () => ({ ok: false, code: 'MULTIPLAYER_DISABLED', message: '달콤상점 멀티플레이는 아직 비활성화되어 있습니다.' });

@WebSocketGateway({ cors: { origin: '*' } })
export class SweetShopGateway {
  constructor(private readonly sweetShop: SweetShopService) {}

  private enabled() { return process.env.SWEET_SHOP_MULTIPLAYER_ENABLED === 'true'; }

  @SubscribeMessage(SWEET_SHOP_EVENTS.loadCafe)
  async loadCafe(@MessageBody() body: { token?: unknown }) {
    if (!this.enabled()) return disabled();
    return { ok: true, data: await this.sweetShop.loadCafe(body?.token) };
  }

  @SubscribeMessage(SWEET_SHOP_EVENTS.orderIngredients) orderIngredients() { return disabled(); }
  @SubscribeMessage(SWEET_SHOP_EVENTS.receiveDelivery) receiveDelivery() { return disabled(); }
  @SubscribeMessage(SWEET_SHOP_EVENTS.startCooking) startCooking() { return disabled(); }
  @SubscribeMessage(SWEET_SHOP_EVENTS.receiveCooking) receiveCooking() { return disabled(); }
  @SubscribeMessage(SWEET_SHOP_EVENTS.completeFirstCookingTutorial)
  async completeFirstCookingTutorial(@MessageBody() body: { token?: unknown }) {
    if (!this.enabled()) return disabled();
    return { ok: true, data: await this.sweetShop.completeFirstCookingTutorial(body?.token) };
  }
  @SubscribeMessage(SWEET_SHOP_EVENTS.createListing) createListing() { return disabled(); }
  @SubscribeMessage(SWEET_SHOP_EVENTS.updateListing) updateListing() { return disabled(); }
  @SubscribeMessage(SWEET_SHOP_EVENTS.removeListing) removeListing() { return disabled(); }
  @SubscribeMessage(SWEET_SHOP_EVENTS.visitCafe) visitCafe() { return disabled(); }
  @SubscribeMessage(SWEET_SHOP_EVENTS.buyDessert) buyDessert() { return disabled(); }
  @SubscribeMessage(SWEET_SHOP_EVENTS.eatDessert) eatDessert() { return disabled(); }
  @SubscribeMessage(SWEET_SHOP_EVENTS.createGuestbook) createGuestbook() { return disabled(); }
}
