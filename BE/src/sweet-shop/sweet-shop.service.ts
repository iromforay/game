import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { SweetShopCafeState } from 'sweet-shop-contracts';
import { AccountService } from '../account/account.service';
import { PrismaService } from '../scoreboard/prisma.service';

@Injectable()
export class SweetShopService {
  constructor(private readonly prisma: PrismaService, private readonly accounts: AccountService) {}

  async loadCafe(token: unknown): Promise<SweetShopCafeState> {
    const accountId = await this.accounts.resolveAccountId(token);
    if (!accountId) throw new UnauthorizedException({ code: 'NOT_LOGGED_IN', message: '로그인이 필요합니다.' });

    await this.prisma.$transaction([
      this.prisma.sweet_shop_profile.upsert({
        where: { account_id: accountId },
        create: { account_id: accountId },
        update: { last_played_at: new Date() },
      }),
      this.prisma.sweet_shop_storage.upsert({
        where: { account_id: accountId },
        create: { account_id: accountId },
        update: {},
      }),
      this.prisma.sweet_shop_recipe_progress.upsert({
        where: { account_id_recipe_id: { account_id: accountId, recipe_id: 'butter-cookie' } },
        create: { account_id: accountId, recipe_id: 'butter-cookie' },
        update: {},
      }),
    ]);

    const [profile, storage, ingredients, recipes] = await Promise.all([
      this.prisma.sweet_shop_profile.findUniqueOrThrow({ where: { account_id: accountId } }),
      this.prisma.sweet_shop_storage.findUniqueOrThrow({ where: { account_id: accountId } }),
      this.prisma.sweet_shop_ingredient.findMany({ where: { account_id: accountId, quantity: { gt: 0 } } }),
      this.prisma.sweet_shop_recipe_progress.findMany({ where: { account_id: accountId } }),
    ]);

    return {
      profile: { cafeName: profile.cafe_name, level: profile.level, experience: profile.experience, gold: profile.gold },
      storage: { ingredientSlotLimit: storage.ingredient_slot_limit, dessertSlotLimit: storage.dessert_slot_limit },
      tutorial: { firstCookingCompleted: profile.first_cooking_tutorial_completed },
      ingredients: Object.fromEntries(ingredients.map((item) => [item.ingredient_id, item.quantity])),
      unlockedRecipes: recipes.map((item) => item.recipe_id) as SweetShopCafeState['unlockedRecipes'],
      deliveries: [],
      cookingJobs: [],
      desserts: [],
      listings: [],
      sales: [],
      buff: null,
      recipeProgress: Object.fromEntries(recipes.map((item) => [item.recipe_id, {
        masteryExperience: item.mastery_experience,
        craftCount: item.total_cooked,
        bestQuality: (['normal', 'good', 'excellent', 'premium'][item.highest_quality - 1] ?? null),
      }])) as SweetShopCafeState['recipeProgress'],
      updatedAt: profile.updated_at.toISOString(),
    };
  }

  async completeFirstCookingTutorial(token: unknown): Promise<SweetShopCafeState> {
    const accountId = await this.accounts.resolveAccountId(token);
    if (!accountId) throw new UnauthorizedException({ code: 'NOT_LOGGED_IN', message: '로그인이 필요합니다.' });

    await this.prisma.sweet_shop_profile.upsert({
      where: { account_id: accountId },
      create: { account_id: accountId, first_cooking_tutorial_completed: true },
      update: { first_cooking_tutorial_completed: true, last_played_at: new Date() },
    });
    return this.loadCafe(token);
  }
}
