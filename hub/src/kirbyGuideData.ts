// 커비 훔치기(Steal a Kirby) 도감 데이터 — docs/Steal a Kirby.md 3.2(등급)/4.2(무기) 확정 값 반영
// 등급/구매가·수익·판매가 수치는 steal_a_kirby/src/config/grades.ts와 동일(밸런싱 이전 임시값)

import rick from './assets/kirby-guide/characters/rick.png';
import kine from './assets/kirby-guide/characters/kine.png';
import coo from './assets/kirby-guide/characters/coo.png';
import chilly from './assets/kirby-guide/characters/chilly.png';
import waddleDoo from './assets/kirby-guide/characters/waddle-doo.png';
import burden from './assets/kirby-guide/characters/burden.png';
import broomHatter from './assets/kirby-guide/characters/broom-hatter.png';
import rocky from './assets/kirby-guide/characters/rocky.png';
import poppyBrosJr from './assets/kirby-guide/characters/poppy-bros-jr.png';
import boomerangKnight from './assets/kirby-guide/characters/boomerang-knight.png';
import bioSpark from './assets/kirby-guide/characters/bio-spark.png';
import bonkers from './assets/kirby-guide/characters/bonkers.png';
import bladeKnight from './assets/kirby-guide/characters/blade-knight.png';
import nesper from './assets/kirby-guide/characters/nesper.png';
import plugg from './assets/kirby-guide/characters/plugg.png';
import daroachIce from './assets/kirby-guide/characters/daroach-ice.png';
import gooey from './assets/kirby-guide/characters/gooey.png';
import magolorMask from './assets/kirby-guide/characters/magolor-mask.png';
import tangEel from './assets/kirby-guide/characters/tang-eel.png';
import flamberge from './assets/kirby-guide/characters/flamberge.png';
import francisca from './assets/kirby-guide/characters/francisca.png';
import zanPartizanne from './assets/kirby-guide/characters/zan-partizanne.png';
import metaKnight from './assets/kirby-guide/characters/meta-knight.png';
import bandanaWaddleDee from './assets/kirby-guide/characters/bandana-waddle-dee.png';
import kingDedede from './assets/kirby-guide/characters/king-dedede.png';
import darkMetaKnight from './assets/kirby-guide/characters/dark-meta-knight.png';
import morphoKnight from './assets/kirby-guide/characters/morpho-knight.png';

// 도감 모달 확대 이미지 — steal_a_kirby/src/assets/kirby/512(고해상도)에서 복사
import rickLarge from './assets/kirby-guide/characters-512/rick.png';
import kineLarge from './assets/kirby-guide/characters-512/kine.png';
import cooLarge from './assets/kirby-guide/characters-512/coo.png';
import chillyLarge from './assets/kirby-guide/characters-512/chilly.png';
import waddleDooLarge from './assets/kirby-guide/characters-512/waddle-doo.png';
import burdenLarge from './assets/kirby-guide/characters-512/burden.png';
import broomHatterLarge from './assets/kirby-guide/characters-512/broom-hatter.png';
import rockyLarge from './assets/kirby-guide/characters-512/rocky.png';
import poppyBrosJrLarge from './assets/kirby-guide/characters-512/poppy-bros-jr.png';
import boomerangKnightLarge from './assets/kirby-guide/characters-512/boomerang-knight.png';
import bioSparkLarge from './assets/kirby-guide/characters-512/bio-spark.png';
import bonkersLarge from './assets/kirby-guide/characters-512/bonkers.png';
import bladeKnightLarge from './assets/kirby-guide/characters-512/blade-knight.png';
import nesperLarge from './assets/kirby-guide/characters-512/nesper.png';
import pluggLarge from './assets/kirby-guide/characters-512/plugg.png';
import daroachIceLarge from './assets/kirby-guide/characters-512/daroach-ice.png';
import gooeyLarge from './assets/kirby-guide/characters-512/gooey.png';
import magolorMaskLarge from './assets/kirby-guide/characters-512/magolor-mask.png';
import tangEelLarge from './assets/kirby-guide/characters-512/tang-eel.png';
import flambergeLarge from './assets/kirby-guide/characters-512/flamberge.png';
import franciscaLarge from './assets/kirby-guide/characters-512/francisca.png';
import zanPartizanneLarge from './assets/kirby-guide/characters-512/zan-partizanne.png';
import metaKnightLarge from './assets/kirby-guide/characters-512/meta-knight.png';
import bandanaWaddleDeeLarge from './assets/kirby-guide/characters-512/bandana-waddle-dee.png';
import kingDededeLarge from './assets/kirby-guide/characters-512/king-dedede.png';
import darkMetaKnightLarge from './assets/kirby-guide/characters-512/dark-meta-knight.png';
import morphoKnightLarge from './assets/kirby-guide/characters-512/morpho-knight.png';

import batImg from './assets/kirby-guide/weapons/bat.png';
import maceImg from './assets/kirby-guide/weapons/mace.png';
import rayGunImg from './assets/kirby-guide/weapons/ray-gun.png';

export interface KirbyGradeInfo {
  id: number;
  name: string;
  color: string;
  weightLabel: string;
  buyPrice: number;
  incomePerTick: number;
  sellPrice: number;
  difficulty: string;
}

export interface KirbyCharacterInfo {
  code: string;
  name: string;
  gradeId: number;
  image: string;
  imageLarge: string;
}

export interface KirbyWeaponInfo {
  name: string;
  type: string;
  image: string;
  status: 'open' | 'locked';
  stats: [string, string][];
}

export const KIRBY_GRADES: KirbyGradeInfo[] = [
  { id: 1, name: '커먼', color: '#9e9e9e', weightLabel: '매우 높음', buyPrice: 20, incomePerTick: 2, sellPrice: 12, difficulty: '쉬움' },
  { id: 2, name: '언커먼', color: '#4caf50', weightLabel: '높음', buyPrice: 60, incomePerTick: 6, sellPrice: 36, difficulty: '쉬움~보통' },
  { id: 3, name: '레어', color: '#2196f3', weightLabel: '보통', buyPrice: 150, incomePerTick: 15, sellPrice: 90, difficulty: '보통' },
  { id: 4, name: '에픽', color: '#9c27b0', weightLabel: '낮음', buyPrice: 400, incomePerTick: 40, sellPrice: 240, difficulty: '보통~어려움' },
  { id: 5, name: '레전더리', color: '#ff9800', weightLabel: '매우 낮음', buyPrice: 1000, incomePerTick: 100, sellPrice: 600, difficulty: '어려움' },
  { id: 6, name: '시크릿', color: '#f44336', weightLabel: '극히 낮음', buyPrice: 5000, incomePerTick: 500, sellPrice: 3000, difficulty: '매우 어려움' },
];

export const KIRBY_CHARACTERS: KirbyCharacterInfo[] = [
  { code: 'rick', name: '릭', gradeId: 1, image: rick, imageLarge: rickLarge },
  { code: 'kine', name: '카인', gradeId: 1, image: kine, imageLarge: kineLarge },
  { code: 'coo', name: '쿠우', gradeId: 1, image: coo, imageLarge: cooLarge },
  { code: 'chilly', name: '칠리', gradeId: 1, image: chilly, imageLarge: chillyLarge },
  { code: 'waddle-doo', name: '웨이들 두', gradeId: 1, image: waddleDoo, imageLarge: waddleDooLarge },
  { code: 'burden', name: '버든', gradeId: 1, image: burden, imageLarge: burdenLarge },
  { code: 'broom-hatter', name: '브룸 해터', gradeId: 1, image: broomHatter, imageLarge: broomHatterLarge },
  { code: 'rocky', name: '록키', gradeId: 1, image: rocky, imageLarge: rockyLarge },
  { code: 'poppy-bros-jr', name: '포피브라더스 Jr.', gradeId: 1, image: poppyBrosJr, imageLarge: poppyBrosJrLarge },

  { code: 'boomerang-knight', name: '부메랑기사', gradeId: 2, image: boomerangKnight, imageLarge: boomerangKnightLarge },
  { code: 'biospark', name: '바이오스파크', gradeId: 2, image: bioSpark, imageLarge: bioSparkLarge },
  { code: 'bonkers', name: '본커스', gradeId: 2, image: bonkers, imageLarge: bonkersLarge },
  { code: 'blade-knight', name: '블레이드 나이트', gradeId: 2, image: bladeKnight, imageLarge: bladeKnightLarge },
  { code: 'nesper', name: '네스퍼', gradeId: 2, image: nesper, imageLarge: nesperLarge },
  { code: 'fluk', name: '플러그', gradeId: 2, image: plugg, imageLarge: pluggLarge },
  { code: 'dophan', name: '다로치(아이스)', gradeId: 2, image: daroachIce, imageLarge: daroachIceLarge },

  { code: 'gooey', name: '구이', gradeId: 3, image: gooey, imageLarge: gooeyLarge },
  { code: 'mabaroa', name: '마골 마스크', gradeId: 3, image: magolorMask, imageLarge: magolorMaskLarge },
  { code: 'tangeo', name: '탱장어', gradeId: 3, image: tangEel, imageLarge: tangEelLarge },

  { code: 'flamberge', name: '플랑베르주', gradeId: 4, image: flamberge, imageLarge: flambergeLarge },
  { code: 'francisca', name: '프랑시스카', gradeId: 4, image: francisca, imageLarge: franciscaLarge },
  { code: 'zan-partizanne', name: '잔 파르티잔느', gradeId: 4, image: zanPartizanne, imageLarge: zanPartizanneLarge },

  { code: 'meta-knight', name: '메타 나이트', gradeId: 5, image: metaKnight, imageLarge: metaKnightLarge },
  { code: 'bandana-waddle-dee', name: '반다나 웨이들 디', gradeId: 5, image: bandanaWaddleDee, imageLarge: bandanaWaddleDeeLarge },
  { code: 'king-dedede', name: '디디디 대왕', gradeId: 5, image: kingDedede, imageLarge: kingDededeLarge },

  { code: 'dark-meta-knight', name: '다크 메타 나이트', gradeId: 6, image: darkMetaKnight, imageLarge: darkMetaKnightLarge },
  { code: 'morpho-knight', name: '몰포 나이트', gradeId: 6, image: morphoKnight, imageLarge: morphoKnightLarge },
];

export const KIRBY_WEAPONS: KirbyWeaponInfo[] = [
  {
    name: '방망이',
    type: '근접 · 기본 무기',
    image: batImg,
    status: 'open',
    stats: [
      ['필요 명중 횟수', '3회'],
      ['사거리', '1 (직접 타격)'],
      ['피격 시 기절 쿨타임', '5초'],
      ['1차 출시', '오픈'],
    ],
  },
  {
    name: '철퇴',
    type: '근접(강화)',
    image: maceImg,
    status: 'locked',
    stats: [
      ['필요 명중 횟수', '방망이보다 적음 (미확정)'],
      ['사거리', '직접 타격 가능성 높음 (미확정)'],
      ['피격 시 기절 쿨타임', '미확정'],
      ['1차 출시', '미오픈 (후순위)'],
    ],
  },
  {
    name: '총',
    type: '원거리',
    image: rayGunImg,
    status: 'locked',
    stats: [
      ['필요 명중 횟수', '1회 (즉시 실패)'],
      ['사거리', '2 이상 (간접 타격, 세부 미정)'],
      ['피격 시 기절 쿨타임', '해당 없음 (1회로 종료)'],
      ['1차 출시', '미오픈 (후순위)'],
    ],
  },
];
