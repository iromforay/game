import coralCustomer from './assets/npc-customer-coral.png';
import greenCustomer from './assets/npc-customer-green.png';
import lavenderCustomer from './assets/npc-customer-lavender.png';
import mintCustomer from './assets/npc-customer-mint.png';
import { SWEET_SHOP_NPC_BUYER_NAMES } from 'sweet-shop-contracts';

export interface SweetShopNpcAppearance {
  id: string;
  image: string;
  staffEligible: boolean;
  preferredJob?: 'procurement' | 'baking' | 'display';
}

export const NPC_BUYER_NAMES = SWEET_SHOP_NPC_BUYER_NAMES;

export const NPC_APPEARANCES: readonly SweetShopNpcAppearance[] = [
  { id: 'mint', image: mintCustomer, staffEligible: true, preferredJob: 'display' },
  { id: 'coral', image: coralCustomer, staffEligible: true, preferredJob: 'baking' },
  { id: 'lavender', image: lavenderCustomer, staffEligible: false },
  { id: 'green', image: greenCustomer, staffEligible: true, preferredJob: 'procurement' },
] as const;

export function appearanceForBuyer(name: string) {
  const nameIndex = NPC_BUYER_NAMES.indexOf(name as (typeof NPC_BUYER_NAMES)[number]);
  const fallbackIndex = [...name].reduce((sum, letter) => sum + (letter.codePointAt(0) ?? 0), 0);
  return NPC_APPEARANCES[(nameIndex >= 0 ? nameIndex : fallbackIndex) % NPC_APPEARANCES.length];
}
