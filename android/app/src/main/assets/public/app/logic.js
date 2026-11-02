// ══════════════════════════════════════════
//  PURE BUSINESS LOGIC
//  DOM-free helpers shared by the app (browser global via <script>)
//  and by unit tests (CommonJS require).
//  Extracted from app.js so it can be unit- and mutation-tested in isolation.
// ══════════════════════════════════════════
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AsthmeTrackLogic = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  // Consecutive red-zone readings required to trigger a crisis banner.
  const CRISIS_THRESHOLD = 2;

  function depZone(dep, bestDEP) {
    const p = (dep / bestDEP) * 100;
    return p >= 80 ? 'green' : p >= 60 ? 'yellow' : 'red';
  }

  function spo2Zone(s) {
    return s >= 95 ? 'green' : s >= 90 ? 'yellow' : 'red';
  }

  function predictedDEP(sex, age, heightCm) {
    const h = heightCm / 100;
    let pef;
    if (sex === 'M') pef = (((h * 5.48) + 1.58) - (age * 0.041)) * 60;
    else             pef = (((h * 3.72) + 2.24) - (age * 0.030)) * 60;
    return Math.round(pef);
  }

  // Compares last 3 days vs previous 3 days. Returns 'up' | 'down' | 'flat' | null.
  // `now` is injectable for deterministic unit tests.
  function calcTrend(measures, field, now = Date.now()) {
    const day3  = 3 * 24 * 3600 * 1000;
    const day6  = 6 * 24 * 3600 * 1000;
    const last3 = measures.filter(m => (now - new Date(m.dt)) < day3);
    const prev3 = measures.filter(m => { const age = now - new Date(m.dt); return age >= day3 && age < day6; });
    if (!last3.length || !prev3.length) return null;
    const avg = arr => arr.reduce((s, m) => s + m[field], 0) / arr.length;
    const diff = avg(last3) - avg(prev3);
    const pct  = Math.abs(diff) / avg(prev3) * 100;
    if (pct < 3) return 'flat';
    return diff > 0 ? 'up' : 'down';
  }

  function isCrisis(measures, bestDEP) {
    if (measures.length < CRISIS_THRESHOLD) return false;
    return measures.slice(0, CRISIS_THRESHOLD).every(m => depZone(m.dep, bestDEP) === 'red');
  }

  return {
    depZone,
    spo2Zone,
    predictedDEP,
    calcTrend,
    isCrisis,
    CRISIS_THRESHOLD,
  };
});