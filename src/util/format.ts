export const NA = 'Not available';

export const fmtPct = (v: number | null | undefined, d = 1) => (v == null ? NA : `${v.toFixed(d)}%`);
/** Proportion (0-1) to percent string. */
export const fmtProp = (v: number | null | undefined, d = 1) => (v == null ? NA : `${(v * 100).toFixed(d)}%`);
export const fmtPP = (v: number | null | undefined, d = 1) =>
  v == null ? NA : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(d)} pts`;
export const fmtUSD = (v: number | null | undefined) => (v == null ? NA : `$${Math.round(v).toLocaleString('en-US')}`);
export const fmtInt = (v: number | null | undefined) => (v == null ? NA : Math.round(v).toLocaleString('en-US'));
export const fmtMiles = (v: number | null | undefined) => (v == null ? NA : `${v.toFixed(v < 10 ? 1 : 0)} mi`);

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Escape untrusted text (names from source files) before inserting into HTML. */
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export function median(vals: (number | null | undefined)[]): number | null {
  const v = vals.filter((x): x is number => x != null).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
