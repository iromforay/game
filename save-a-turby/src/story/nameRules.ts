// 이름 입력 안내(Codex D5와 같은 규칙). 판정은 서버가 한다 — 여기는 입력 중 안내와 서버 사유의 화면 문구만.
export const NAME_RULE_TEXT = '1~10자 · 한글, 영문, 숫자 · 단어 사이 공백은 한 칸';

const NAME_PATTERN = /^[가-힣A-Za-z0-9]+( [가-힣A-Za-z0-9]+)*$/;

// 서버에 보내기 전 안내용 검사. 통과해도 서버가 금칙어 등으로 거절할 수 있다.
export function precheckName(raw: string): { ok: true; name: string } | { ok: false; reason: string } {
  const name = raw.trim();
  const length = [...name].length;
  if (length < 1 || length > 10) return { ok: false, reason: 'length' };
  if (!NAME_PATTERN.test(name)) return { ok: false, reason: 'characters' };
  if (name === '터비 탐험가') return { ok: false, reason: 'default_name' };
  return { ok: true, name };
}

export function nameReasonMessage(reason: string | null | undefined): string {
  switch (reason) {
    case 'length':
      return '이름은 1~10자로 입력해 주세요.';
    case 'characters':
      return '한글, 영문, 숫자와 단어 사이 공백 한 칸만 쓸 수 있어요.';
    case 'default_name':
      return '다른 이름을 입력해 주세요.';
    case 'banned_word':
      return '사용할 수 없는 단어가 들어 있어요.';
    default:
      return '이 이름은 사용할 수 없어요.';
  }
}
