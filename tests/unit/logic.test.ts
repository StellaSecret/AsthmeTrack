import { describe, it, expect } from 'vitest';
import logic from '../../www/app/logic.js';

const { depZone, spo2Zone, predictedDEP, calcTrend, isCrisis, CRISIS_THRESHOLD } = logic;

const BEST = 400;
const hrs = (n: number) => new Date(Date.now() - n * 3600 * 1000).toISOString();

describe('depZone', () => {
  it('green at ≥80% of bestDEP', () => {
    expect(depZone(320, BEST)).toBe('green');
    expect(depZone(400, BEST)).toBe('green');
  });
  it('yellow at 60–79% of bestDEP', () => {
    expect(depZone(240, BEST)).toBe('yellow');
    expect(depZone(300, BEST)).toBe('yellow');
    expect(depZone(319, BEST)).toBe('yellow');
  });
  it('red below 60% of bestDEP', () => {
    expect(depZone(239, BEST)).toBe('red');
    expect(depZone(100, BEST)).toBe('red');
  });
});

describe('spo2Zone', () => {
  it('green at ≥95', () => {
    expect(spo2Zone(95)).toBe('green');
    expect(spo2Zone(100)).toBe('green');
  });
  it('yellow at 90–94', () => {
    expect(spo2Zone(90)).toBe('yellow');
    expect(spo2Zone(94)).toBe('yellow');
  });
  it('red below 90', () => {
    expect(spo2Zone(89)).toBe('red');
    expect(spo2Zone(80)).toBe('red');
  });
});

describe('predictedDEP', () => {
  it('applies male formula', () => {
    const h = 1.75;
    expect(predictedDEP('M', 35, 175)).toBe(Math.round((((h * 5.48) + 1.58) - (35 * 0.041)) * 60));
  });
  it('applies female formula', () => {
    const h = 1.62;
    expect(predictedDEP('F', 50, 162)).toBe(Math.round((((h * 3.72) + 2.24) - (50 * 0.030)) * 60));
  });
  it('is higher for younger/older-corrected male', () => {
    expect(predictedDEP('M', 30, 175)).toBeGreaterThan(predictedDEP('M', 60, 175));
  });
});

describe('calcTrend', () => {
  const NOW = 1_750_000_000_000;
  const ts = (h: number) => new Date(NOW - h * 3600 * 1000).toISOString();
  const m = (h: number, dep: number, spo2 = 97) => ({ dt: ts(h), dep, spo2 });

  it('returns null when not enough data', () => {
    expect(calcTrend([], 'dep', NOW)).toBeNull();
    expect(calcTrend([m(1, 400)], 'dep', NOW)).toBeNull();
  });
  it('defaults the clock to now (2-arg call)', () => {
    expect(calcTrend([{ dt: hrs(1), dep: 400, spo2: 97 }, { dt: hrs(96), dep: 200, spo2: 97 }], 'dep')).toBe('up');
  });
  it('returns flat when change < 3%', () => {
    const measures = [m(8, 404), m(32, 400), m(56, 398), m(80, 400), m(104, 402), m(128, 401)];
    expect(calcTrend(measures, 'dep', NOW)).toBe('flat');
  });
  it('returns up when last window is higher', () => {
    const measures = [m(8, 500), m(32, 480), m(56, 490), m(80, 400), m(104, 410), m(128, 405)];
    expect(calcTrend(measures, 'dep', NOW)).toBe('up');
  });
  it('returns down when last window is lower', () => {
    const measures = [m(8, 350), m(32, 360), m(56, 340), m(80, 410), m(104, 420), m(128, 415)];
    expect(calcTrend(measures, 'dep', NOW)).toBe('down');
  });
  it('uses the requested field', () => {
    const measures = [m(8, 400, 99), m(32, 400, 98), m(56, 400, 97), m(80, 400, 95)];
    expect(calcTrend(measures, 'spo2', NOW)).toBe('up');
  });
  it('treats a measure exactly 3 days old as previous-window', () => {
    expect(calcTrend([m(8, 600), m(72, 400)], 'dep', NOW)).toBe('up');
  });
  it('keeps an exactly-3-days-old measure out of the last window', () => {
    expect(calcTrend([m(120, 100), m(72, 400)], 'dep', NOW)).toBeNull();
  });
  it('treats a measure exactly 6 days old as outside the windows', () => {
    expect(calcTrend([m(8, 400), m(144, 600)], 'dep', NOW)).toBeNull();
  });
  it('classes negligible relative change as flat even with few samples', () => {
    expect(calcTrend([m(8, 400), m(32, 400), m(80, 396)], 'dep', NOW)).toBe('flat');
  });
  it('returns up at the exact 3% relative-change boundary', () => {
    expect(calcTrend([m(8, 412), m(80, 400)], 'dep', NOW)).toBe('up');
  });
});

describe('isCrisis', () => {
  const red = { dt: hrs(1), dep: 200, spo2: 97 };
  const ok = { dt: hrs(24), dep: 400, spo2: 97 };

  it('needs at least CRISIS_THRESHOLD readings', () => {
    expect(isCrisis([], BEST)).toBe(false);
    expect(isCrisis([red], BEST)).toBe(false);
  });
  it('triggers on consecutive red-zone readings', () => {
    expect(isCrisis([red, red], BEST)).toBe(true);
  });
  it('does not trigger when any recent reading is not red', () => {
    expect(isCrisis([red, ok], BEST)).toBe(false);
    expect(isCrisis([ok, red], BEST)).toBe(false);
  });
  it('does not mutate its input array', () => {
    const arr = [red, ok, red];
    expect(isCrisis(arr, BEST)).toBe(false);
    expect(arr).toHaveLength(3);
  });
  it('triggers even when an older reading is not red', () => {
    expect(isCrisis([red, red, ok], BEST)).toBe(true);
  });
  it('exposes the threshold constant', () => {
    expect(CRISIS_THRESHOLD).toBe(2);
  });
});