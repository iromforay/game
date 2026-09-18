// 커비 훔치기 등급/캐릭터 초기 데이터 시드 — FE(steal_a_kirby)의 kirbies.json/grades.ts를 정본으로 삼아
// BE DB에도 동일하게 채워 넣음(두 값이 어긋나지 않도록 나중엔 한쪽에서 생성하는 방식도 고려 가능, 지금은 수동 동기화).
// 실행: npx ts-node --transpile-only prisma/seed-kirby.ts
import { PrismaClient } from '@prisma/client';
import kirbies from '../../steal_a_kirby/src/data/kirbies.json';

const prisma = new PrismaClient();

const GRADES = [
  { id: 1, name: '커먼', buy_price: 20, income_per_tick: 2, sell_price: 12 },
  { id: 2, name: '언커먼', buy_price: 60, income_per_tick: 6, sell_price: 36 },
  { id: 3, name: '레어', buy_price: 150, income_per_tick: 15, sell_price: 90 },
  { id: 4, name: '에픽', buy_price: 400, income_per_tick: 40, sell_price: 240 },
  { id: 5, name: '레전더리', buy_price: 1000, income_per_tick: 100, sell_price: 600 },
  { id: 6, name: '시크릿', buy_price: 5000, income_per_tick: 500, sell_price: 3000 },
];

// relationMode="prisma" 환경에서 kirby_grade/kirby_character처럼 자식 관계가 있는 테이블에
// .upsert()를 쓰면 실제로는 관계를 안 건드리는 갱신인데도 P2014(관계 위반 오탐)가 나는 경우가
// 있어, find→update/create로 직접 분기해서 우회한다.
async function upsertGrade(grade: { id: number; name: string; buy_price: number; income_per_tick: number; sell_price: number }) {
  const { id, ...data } = grade;
  const existing = await prisma.kirby_grade.findUnique({ where: { id } });
  if (existing) await prisma.kirby_grade.update({ where: { id }, data });
  else await prisma.kirby_grade.create({ data: grade });
}

async function upsertCharacter(k: { code: string; name: string; gradeId: number; weight: number; imageKey: string | null }) {
  const data = { name: k.name, grade_id: k.gradeId, weight: k.weight, image_key: k.imageKey };
  const existing = await prisma.kirby_character.findUnique({ where: { code: k.code } });
  if (existing) await prisma.kirby_character.update({ where: { code: k.code }, data });
  else await prisma.kirby_character.create({ data: { code: k.code, ...data } });
}

async function main() {
  for (const grade of GRADES) {
    await upsertGrade(grade);
  }

  for (const k of kirbies as { code: string; name: string; gradeId: number; weight: number; imageKey: string | null }[]) {
    await upsertCharacter(k);
  }

  console.log(`시드 완료: 등급 ${GRADES.length}종, 캐릭터 ${kirbies.length}종`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
