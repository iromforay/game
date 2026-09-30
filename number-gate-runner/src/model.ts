export type GateOperation = 'add' | 'subtract' | 'multiply' | 'divide';

export interface GateRule {
  operation: GateOperation;
  value: number;
}

export function applyGate(count: number, gate: GateRule): number {
  const safeCount = Math.max(0, Math.floor(count));
  const value = Math.max(0, Math.floor(gate.value));
  switch (gate.operation) {
    case 'add':
      return safeCount + value;
    case 'subtract':
      return Math.max(0, safeCount - value);
    case 'multiply':
      return safeCount * value;
    case 'divide':
      return value === 0 ? safeCount : Math.floor(safeCount / value);
  }
}

export function gateLabel(gate: GateRule): string {
  const symbol: Record<GateOperation, string> = { add: '+', subtract: '−', multiply: '×', divide: '÷' };
  return `${symbol[gate.operation]}${gate.value.toLocaleString('ko-KR')}`;
}

export function representativeCount(actualCount: number): number {
  if (actualCount <= 0) return 0;
  if (actualCount < 180) return 8;
  if (actualCount < 400) return 12;
  if (actualCount < 800) return 16;
  return 20;
}

export function swarmPenetration(actualCount: number): number {
  return Math.min(12, Math.max(3, 3 + Math.floor(Math.max(0, actualCount) / 280)));
}
