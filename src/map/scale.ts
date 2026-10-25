// Classed colour scales. Breaks are always computed from BOTH states' values so a
// colour means the same value in the Massachusetts and Georgia panels.
import type { MetricDef } from '../config/metrics';
import type { County } from '../types';

// Warm sequential ramp inspired by the reference (cream -> ember -> oxblood).
const SEQ = ['#fde7c4', '#fcbf7f', '#f9914f', '#e4592f', '#bb2c1a', '#7c0f0c'];
// Diverging: below comparison = warm, above = cool teal; middle class = within ±1 point.
const DIV = ['#b7321e', '#e2774c', '#f2bf9d', '#cfccc4', '#93c4c9', '#4c97a5', '#1f6575'];
// Ordinal rurality: pale slate (metro) to deep ochre (most rural).
const ORD = ['#d7dde3', '#b9c3cc', '#9aa8b4', '#e9cf8f', '#d8b062', '#c19243', '#a3742f', '#7f5620', '#5c3c15'];
export const MISSING_COLOR = '#3a3b3f';

export interface ClassBin { color: string; min: number; max: number; label: string }
export interface Scale { bins: ClassBin[]; colorFor: (v: number | null) => string | null; classOf: (v: number | null) => number }

function niceStep(range: number, n: number) {
  const raw = range / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const r = raw / mag;
  return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * mag;
}

export function buildScale(m: MetricDef, counties: County[]): Scale | null {
  const vals = counties.map((c) => m.get(c)).filter((v): v is number => v != null);
  if (!vals.length) return null;
  let thresholds: number[];
  let colors: string[];

  if (m.scale === 'ord') {
    thresholds = [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5];
    colors = ORD;
  } else if (m.scale === 'div') {
    const maxAbs = Math.max(...vals.map(Math.abs), 3);
    const s = niceStep(maxAbs, 3);
    thresholds = [-2 * s, -s, -1, 1, s, 2 * s];
    colors = DIV;
  } else {
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const step = niceStep(hi - lo || 1, SEQ.length);
    const start = Math.floor(lo / step) * step;
    thresholds = Array.from({ length: SEQ.length - 1 }, (_, i) => start + step * (i + 1));
    // Trim empty top classes created by rounding.
    while (thresholds.length && thresholds[thresholds.length - 1] >= hi) thresholds.pop();
    // Always keep the darkest colour at the emphasized end.
    colors = SEQ.slice(SEQ.length - thresholds.length - 1);
    if (m.emphasis === 'low') colors = colors.reverse();
  }

  const classOf = (v: number | null) => {
    if (v == null) return -1;
    let i = 0;
    while (i < thresholds.length && v >= thresholds[i]) i++;
    return i;
  };
  const fmt = (v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : Number.isInteger(v) ? String(v) : v.toFixed(1));
  const bins: ClassBin[] = colors.map((color, i) => {
    const min = i === 0 ? -Infinity : thresholds[i - 1];
    const max = i === thresholds.length ? Infinity : thresholds[i];
    let label: string;
    if (m.scale === 'ord') label = String(i + 1);
    else if (min === -Infinity) label = `< ${fmt(max)}`;
    else if (max === Infinity) label = `≥ ${fmt(min)}`;
    else label = `${fmt(min)} – ${fmt(max)}`;
    if (m.scale === 'div' && min === -1 && max === 1) label = 'within ±1';
    return { color, min, max, label };
  });
  return { bins, classOf, colorFor: (v) => (v == null ? null : colors[classOf(v)]) };
}
