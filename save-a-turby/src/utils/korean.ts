// 한글 받침 유무에 따라 조사(이/가, 을/를 등)를 고를 때 쓰는 헬퍼
export function hasBatchim(word: string): boolean {
  const lastChar = word.at(-1);
  if (!lastChar) return false;
  const code = lastChar.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return false; // 한글 음절 범위 밖(영문/숫자 등)이면 받침 없음으로 취급
  return code % 28 !== 0;
}

export function withEunNeun(word: string): string {
  return `${word}${hasBatchim(word) ? '은' : '는'}`;
}

export function withIGa(word: string): string {
  return `${word}${hasBatchim(word) ? '이' : '가'}`;
}

export function withEulReul(word: string): string {
  return `${word}${hasBatchim(word) ? '을' : '를'}`;
}
