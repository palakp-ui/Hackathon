// One interactive map for one state. Presentation only: it receives already-computed
// colours/flags from the app and reports hover/selection back.
import type maplibregl from 'maplibre-gl';
import { BLANK_STYLE, type Engine } from './engine';
import { MISSING_COLOR } from './scale';
import type { Institution, StateAbbr } from '../types';
import { esc, fmtProp } from '../util/format';

export interface CountyStyle { color: string | null; dim: boolean; height: number; below: boolean }
export interface PanelCallbacks {
  onHover: (fips: string | null, ev?: { x: number; y: number }) => void;
  onSelect: (fips: string) => void;
}

export const PELL_BINS = [
  { max: 20, color: '#d4eef4', label: '< 20%' },
  { max: 35, color: '#93d0e3', label: '20 – 35%' },
  { max: 50, color: '#4fa6d4', label: '35 – 50%' },
  { max: Infinity, color: '#8b6fe0', label: '≥ 50%' },
];
const pellColor = (p: number | null) => (p == null ? '#7d7d7d' : PELL_BINS.find((b) => p < b.max)!.color);

function hatchImage(): { width: number; height: number; data: Uint8Array } {
  const size = 8, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const on = (x + y) % size < 2;
    const i = (y * size + x) * 4;
    data.set(on ? [150, 150, 155, 255] : [40, 41, 45, 255], i);
  }
  return { width: size, height: size, data };
}

export class StatePanel {
  map: maplibregl.Map;
  private ready: Promise<void>;
  private features: GeoJSON.Feature[];
  private hoverId: number | null = null;
  private selectedId: number | null = null;
  private bounds: [number, number, number, number];
  private popup: maplibregl.Popup | null = null;

  constructor(private engine: Engine, container: HTMLElement, public state: StateAbbr, geo: GeoJSON.FeatureCollection, private cb: PanelCallbacks) {
    this.features = geo.features.filter((f) => f.properties?.state === state);
    this.bounds = bbox(this.features);
    const { lib } = engine;
    this.map = new lib.Map({
      container,
      style: engine.style,
      bounds: this.bounds,
      fitBoundsOptions: { padding: 28 },
      attributionControl: false,
      dragRotate: true,
      maxPitch: 60,
    });
    this.map.addControl(new lib.NavigationControl({ visualizePitch: true }), 'top-left');
    this.map.addControl(new lib.ScaleControl({ unit: 'imperial', maxWidth: 90 }), 'bottom-left');
    this.map.addControl(new lib.AttributionControl({ compact: true, customAttribution: 'County boundaries: U.S. Census Bureau' }), 'bottom-right');
    // Add county layers as soon as the style is parsed; don't wait for every basemap tile.
    // If the remote basemap never loads (slow/blocked network), fall back to a blank style.
    this.ready = new Promise((resolve) => {
      let done = false;
      const init = () => { if (done) return; done = true; clearTimeout(timer); this.addLayers(); resolve(); };
      const timer = setTimeout(() => {
        if (done) return;
        console.warn(`[${state} map] basemap slow to load; using plain background`);
        this.map.once('style.load', init);
        this.map.setStyle(BLANK_STYLE);
      }, 8000);
      if (this.map.isStyleLoaded()) init(); else this.map.once('style.load', init);
    });
    this.map.on('error', (e) => console.warn(`[${state} map]`, e.error?.message ?? e));
    new ResizeObserver(() => this.map.resize()).observe(container);
  }

  whenReady() { return this.ready; }

  private addLayers() {
    const m = this.map;
    m.addImage('hatch', hatchImage());
    m.addSource('counties', { type: 'geojson', data: { type: 'FeatureCollection', features: this.features } });
    m.addLayer({ id: 'counties-fill', type: 'fill', source: 'counties', paint: {
      'fill-color': ['coalesce', ['get', 'color'], MISSING_COLOR],
      'fill-opacity': ['case', ['boolean', ['get', 'dim'], false], 0.12, 0.9],
    } });
    m.addLayer({ id: 'counties-missing', type: 'fill', source: 'counties', filter: ['==', ['get', 'missing'], true], paint: {
      'fill-pattern': 'hatch', 'fill-opacity': ['case', ['boolean', ['get', 'dim'], false], 0.2, 0.85],
    } });
    m.addLayer({ id: 'counties-extrude', type: 'fill-extrusion', source: 'counties', layout: { visibility: 'none' }, paint: {
      'fill-extrusion-color': ['coalesce', ['get', 'color'], MISSING_COLOR],
      'fill-extrusion-height': ['get', 'height'],
      'fill-extrusion-opacity': 0.92,
    } });
    m.addLayer({ id: 'counties-line', type: 'line', source: 'counties', paint: {
      'line-color': '#f4efe6', 'line-opacity': 0.28, 'line-width': this.state === 'MA' ? 0.9 : 0.5,
    } });
    m.addLayer({ id: 'counties-below', type: 'line', source: 'counties', filter: ['==', ['get', 'below'], true], layout: { visibility: 'none' }, paint: {
      'line-color': '#ffd27a', 'line-width': 1.8, 'line-dasharray': [2, 1.2],
    } });
    m.addLayer({ id: 'counties-focus', type: 'line', source: 'counties', paint: {
      'line-color': '#ffffff',
      'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 2.6, ['boolean', ['feature-state', 'hover'], false], 1.8, 0],
    } });
    m.addSource('colleges', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    m.addLayer({ id: 'colleges', type: 'circle', source: 'colleges', layout: { visibility: 'none' }, paint: {
      'circle-color': ['get', 'color'],
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, ['*', 0.55, ['get', 'r']], 9, ['*', 1.4, ['get', 'r']]],
      'circle-stroke-color': ['case', ['get', 'selective'], '#ffffff', '#101114'],
      'circle-stroke-width': ['case', ['get', 'selective'], 1.6, 0.6],
      'circle-opacity': 0.92,
    } });

    m.on('mousemove', 'counties-fill', (e) => {
      const f = e.features?.[0];
      if (!f) return;
      this.setHover(Number(f.id));
      m.getCanvas().style.cursor = 'pointer';
      const r = m.getContainer().getBoundingClientRect();
      this.cb.onHover(String(f.properties?.fips), { x: r.left + e.point.x, y: r.top + e.point.y });
    });
    m.on('mouseleave', 'counties-fill', () => { this.setHover(null); m.getCanvas().style.cursor = ''; this.cb.onHover(null); });
    m.on('click', (e) => {
      const college = m.getLayoutProperty('colleges', 'visibility') === 'visible'
        ? m.queryRenderedFeatures(e.point, { layers: ['colleges'] })[0] : undefined;
      if (college) { this.showCollegePopup(college, e.lngLat); return; }
      const f = m.queryRenderedFeatures(e.point, { layers: ['counties-fill'] })[0];
      if (f) this.cb.onSelect(String(f.properties?.fips));
    });
    m.on('mouseenter', 'colleges', () => (m.getCanvas().style.cursor = 'pointer'));
  }

  private setHover(id: number | null) {
    if (this.hoverId === id) return;
    if (this.hoverId != null) this.map.setFeatureState({ source: 'counties', id: this.hoverId }, { hover: false });
    this.hoverId = id;
    if (id != null) this.map.setFeatureState({ source: 'counties', id }, { hover: true });
  }

  async setSelected(fips: string | null) {
    await this.ready;
    const id = fips && this.features.some((f) => f.properties?.fips === fips) ? Number(fips) : null;
    if (this.selectedId != null) this.map.setFeatureState({ source: 'counties', id: this.selectedId }, { selected: false });
    this.selectedId = id;
    if (id != null) this.map.setFeatureState({ source: 'counties', id }, { selected: true });
  }

  async render(styles: Map<string, CountyStyle>, opts: { extrude: boolean; markBelow: boolean }) {
    await this.ready;
    const features = this.features.map((f) => {
      const s = styles.get(String(f.properties?.fips))!;
      return { ...f, properties: { ...f.properties, color: s.color, missing: s.color == null, dim: s.dim, height: s.height, below: s.below } };
    });
    (this.map.getSource('counties') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features });
    this.map.setLayoutProperty('counties-extrude', 'visibility', opts.extrude ? 'visible' : 'none');
    this.map.setLayoutProperty('counties-below', 'visibility', opts.markBelow ? 'visible' : 'none');
    const pitch = opts.extrude ? 50 : 0;
    if (this.map.getPitch() !== pitch) this.map.easeTo({ pitch, duration: 700 });
  }

  async setColleges(list: Institution[] | null) {
    await this.ready;
    this.map.setLayoutProperty('colleges', 'visibility', list ? 'visible' : 'none');
    if (!list) { this.popup?.remove(); return; }
    (this.map.getSource('colleges') as maplibregl.GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: list.map((i) => ({
        type: 'Feature', id: i.id, geometry: { type: 'Point', coordinates: [i.lon, i.lat] },
        properties: { id: i.id, color: pellColor(i.pell_pct_undergrad), selective: i.more_selective, r: Math.max(2.5, Math.min(11, Math.sqrt((i.undergrads ?? 400) / 60))), json: JSON.stringify(i) },
      })),
    });
  }

  private showCollegePopup(f: maplibregl.MapGeoJSONFeature, at: maplibregl.LngLat) {
    const i = JSON.parse(f.properties.json) as Institution;
    const g = i.pell_grad;
    const html = `<div class="college-pop">
      <strong>${esc(i.name)}</strong>
      <div class="muted">${esc(i.city)}, ${esc(i.state)} · ${esc(i.control)} ${esc(i.level)}${i.more_selective ? ' · most selective (elite)' : i.selective ? ' · selective' : ''}${i.hbcu ? ' · HBCU' : ''}</div>
      <dl>
        <dt>Undergraduates awarded Pell (2022–23)</dt><dd>${i.pell_pct_undergrad == null ? 'Not reported' : i.pell_pct_undergrad + '%'}</dd>
        <dt>First-time, full-time awarded Pell</dt><dd>${i.pell_pct_ftft == null ? 'Not reported' : i.pell_pct_ftft + '%'}</dd>
        <dt>Completion: Pell recipients</dt><dd>${g?.pell_rate == null ? 'Withheld / n.a.' : fmtProp(g.pell_rate)}${g?.pell_n ? ` <span class="muted">(n=${g.pell_n})</span>` : ''}</dd>
        <dt>Completion: all other students</dt><dd>${g?.nonpell_rate == null ? 'Withheld / n.a.' : fmtProp(g.nonpell_rate)}${g?.nonpell_n ? ` <span class="muted">(n=${g.nonpell_n})</span>` : ''}</dd>
      </dl>
      ${g ? `<p class="fine">${esc(g.cohort)}. IPEDS.</p>` : ''}
      <p class="fine">Describes students enrolled at this institution, not students from any county.</p>
    </div>`;
    this.popup?.remove();
    this.popup = new this.engine.lib.Popup({ maxWidth: '300px', closeButton: true }).setLngLat(at).setHTML(html).addTo(this.map);
  }

  fit(animate = false) { this.map.resize(); this.map.fitBounds(this.bounds, { padding: 28, animate }); }

  flyTo(fips: string) {
    const f = this.features.find((x) => x.properties?.fips === fips);
    if (!f) return;
    this.map.fitBounds(bbox([f]), { padding: 80, maxZoom: this.state === 'MA' ? 9 : 8.5, duration: 900 });
  }
}

function bbox(features: GeoJSON.Feature[]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const walk = (c: unknown): void => {
    if (typeof (c as number[])[0] === 'number') {
      const [x, y] = c as number[];
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    } else (c as unknown[]).forEach(walk);
  };
  for (const f of features) walk((f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon).coordinates);
  return [x0, y0, x1, y1];
}
