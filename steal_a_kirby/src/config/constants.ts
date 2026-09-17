// 7번 화면/캔버스 규격 확정: 가로(landscape) 고정, 1280x720
// 4.0 확정: 이 게임은 카메라 스크롤이 없음 — 각 화면(필드) 크기 자체가 이 고정 캔버스 크기와 같음
export const CANVAS_WIDTH = 1280;
export const CANVAS_HEIGHT = 720;

// 2.1 확정: 시작 자금
export const STARTING_GOLD = 100;

// 3.5.1(save-a-turby) 재사용 패턴 — 4.0 오픈형 자유이동(가상 조이스틱, 그리드 스냅 없음)
export const AVATAR_SPEED = 200; // px/sec, 밸런싱 전 임시값
export const JOYSTICK_BASE_RADIUS = 55;
export const JOYSTICK_THUMB_RADIUS = 26;

// 4.2 확정(2026-09-17): 1차 출시 무기 = 방망이만
// 사거리=1은 거리 수치가 아니라 "직접 타격(콜리전 판정)"이라는 방식 구분 — 별도 반경 파라미터 불필요.
// BAT_HIT_RADIUS_PX는 그 콜리전 판정에 쓰는 순수 구현 수치(8.2-⑭, 아직 실측 전 임시값).
export const BAT_HITS_REQUIRED = 3; // 누적 3회 명중해야 붙잡힘 처리
export const BAT_STUN_MS = 5000; // 명중 1회당 침입자 기절(행동불능) 시간
export const BAT_HIT_RADIUS_PX = 48; // 임시값 — 실측/밸런싱 전
