export interface Measure {
  id?: number;
  dt: string;
  dep: number;
  dep1?: number;
  dep2?: number;
  dep3?: number;
  spo2: number;
  easy?: number;
  comment?: string;
  [key: string]: unknown;
}

interface Logic {
  depZone(dep: number, bestDEP: number): 'green' | 'yellow' | 'red';
  spo2Zone(s: number): 'green' | 'yellow' | 'red';
  predictedDEP(sex: string, age: number, heightCm: number): number;
  calcTrend(measures: Measure[], field: string): 'up' | 'down' | 'flat' | null;
  isCrisis(measures: Measure[], bestDEP: number): boolean;
  readonly CRISIS_THRESHOLD: number;
}

declare const logic: Logic;
export = logic;