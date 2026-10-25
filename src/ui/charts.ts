// Small dependency-free SVG charts. Each returns an accessible SVG string.
import { esc } from '../util/format';

export interface ScatterPoint { x: number; y: number; label: string; highlight?: boolean; peer?: boolean }

export function scatter(points: ScatterPoint[], o: {
  title: string; xLabel: string; yLabel: string; xFmt: (v: number) => string; yFmt: (v: number) => string; refY?: number | null; refLabel?: string;
}): string {
  if (points.length < 3) return `<p class="muted small">Not enough counties with data for this chart.</p>`;
  const W = 340, H = 210, L = 44, R = 12, T = 12, B = 36;
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y).concat(o.refY != null ? [o.refY] : []);
  const pad = (a: number, b: number) => [(a - (b - a) * 0.06), (b + (b - a) * 0.06)];
  const [x0, x1] = pad(Math.min(...xs), Math.max(...xs));
  const [y0, y1] = pad(Math.min(...ys), Math.max(...ys));
  const sx = (v: number) => L + ((v - x0) / (x1 - x0 || 1)) * (W - L - R);
  const sy = (v: number) => H - B - ((v - y0) / (y1 - y0 || 1)) * (H - T - B);
  const ticks = (a: number, b: number) => [a + (b - a) * 0.1, (a + b) / 2, b - (b - a) * 0.1];
  const sel = points.find((p) => p.highlight);
  const dots = [...points].sort((a, b) => Number(!!a.highlight) - Number(!!b.highlight)).map((p) => {
    const cls = p.highlight ? 'dot dot-sel' : p.peer ? 'dot dot-peer' : 'dot';
    return `<circle class="${cls}" cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="${p.highlight ? 5 : 3}"><title>${esc(p.label)}: ${esc(o.xFmt(p.x))}, ${esc(o.yFmt(p.y))}</title></circle>`;
  }).join('');
  const ref = o.refY != null ? `<line class="ref" x1="${L}" x2="${W - R}" y1="${sy(o.refY)}" y2="${sy(o.refY)}"/><text class="ref-label" x="${W - R}" y="${sy(o.refY) - 4}" text-anchor="end">${esc(o.refLabel ?? '')}</text>` : '';
  const desc = sel ? `${sel.label} is highlighted at ${o.xFmt(sel.x)}, ${o.yFmt(sel.y)}.` : '';
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.title)}. ${points.length} counties. ${esc(desc)}">
    <g class="axis">${ticks(x0, x1).map((t) => `<text x="${sx(t)}" y="${H - B + 14}" text-anchor="middle">${esc(o.xFmt(t))}</text>`).join('')}
    ${ticks(y0, y1).map((t) => `<text x="${L - 6}" y="${sy(t) + 3}" text-anchor="end">${esc(o.yFmt(t))}</text><line class="grid" x1="${L}" x2="${W - R}" y1="${sy(t)}" y2="${sy(t)}"/>`).join('')}
    <text x="${(L + W - R) / 2}" y="${H - 4}" text-anchor="middle" class="axis-title">${esc(o.xLabel)}</text>
    <text transform="translate(11 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle" class="axis-title">${esc(o.yLabel)}</text></g>
    ${ref}${dots}</svg>`;
}

export interface BarItem { label: string; value: number | null; compare?: number | null; note?: string }

/** Horizontal bars for proportions (0-1). `compare` draws a benchmark tick. */
export function bars(items: BarItem[], o: { title: string; compareLabel?: string; max?: number }): string {
  const max = o.max ?? Math.max(0.05, ...items.flatMap((i) => [i.value ?? 0, i.compare ?? 0]));
  const rows = items.map((i) => {
    const w = i.value == null ? 0 : (i.value / max) * 100;
    const c = i.compare == null ? '' : `<span class="bar-tick" style="left:${(i.compare / max) * 100}%" title="${esc(o.compareLabel ?? 'Benchmark')}: ${(i.compare * 100).toFixed(1)}%"></span>`;
    const val = i.value == null ? '<span class="muted">n/a</span>' : `${(i.value * 100).toFixed(1)}%`;
    return `<div class="bar-row"><span class="bar-label">${esc(i.label)}</span><span class="bar-track">${i.value == null ? '<span class="bar-missing"></span>' : `<span class="bar-fill" style="width:${w}%"></span>`}${c}</span><span class="bar-val">${val}</span></div>`;
  }).join('');
  const legend = o.compareLabel ? `<div class="bar-legend"><span class="bar-tick-key"></span>${esc(o.compareLabel)}</div>` : '';
  return `<div class="bars" role="group" aria-label="${esc(o.title)}">${rows}${legend}</div>`;
}

/** Paired bars: Pell recipients vs. other students at each institution. */
export function pairedBars(items: { label: string; a: number | null; b: number | null; sub?: string }[], o: { title: string; aLabel: string; bLabel: string }): string {
  if (!items.length) return '<p class="muted small">No institutions with reported Pell completion rates nearby.</p>';
  const rows = items.map((i) => {
    const bar = (v: number | null, cls: string) => (v == null ? `<span class="pb ${cls} pb-missing" style="width:100%" title="Withheld or not reported"></span>` : `<span class="pb ${cls}" style="width:${v * 100}%"></span>`);
    const txt = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`);
    return `<div class="pb-row"><div class="pb-name">${esc(i.label)}${i.sub ? `<span class="muted"> · ${esc(i.sub)}</span>` : ''}</div>
      <div class="pb-line"><span class="pb-track">${bar(i.a, 'pb-a')}</span><span class="pb-val">${txt(i.a)}</span></div>
      <div class="pb-line"><span class="pb-track">${bar(i.b, 'pb-b')}</span><span class="pb-val">${txt(i.b)}</span></div></div>`;
  }).join('');
  return `<div class="paired" role="group" aria-label="${esc(o.title)}"><div class="bar-legend"><span class="key pb-a"></span>${esc(o.aLabel)} <span class="key pb-b"></span>${esc(o.bLabel)}</div>${rows}</div>`;
}
