import practiceYardUrl from './maps/practice-yard.png?url';
import carpetCourtUrl from './maps/carpet-court.png?url';
import billiardTableUrl from './maps/billiard-table.png?url';

interface MapBackgroundTexture {
  key: string;
  url: string;
}

export const MAP_BACKGROUND_TEXTURES: Record<number, MapBackgroundTexture> = {
  1: { key: 'map-background-practice-yard', url: practiceYardUrl },
  2: { key: 'map-background-carpet-court', url: carpetCourtUrl },
  3: { key: 'map-background-billiard-table', url: billiardTableUrl },
};
