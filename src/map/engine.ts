// Chooses the map library at runtime.
//  - VITE_MAPBOX_ACCESS_TOKEN set and valid  -> Mapbox GL JS + Mapbox Dark basemap
//  - otherwise                               -> MapLibre GL JS + CARTO Dark Matter basemap
//  - basemap unreachable (offline)           -> MapLibre with a plain dark background
// County polygons are always loaded from local data, so the map works in every case.
import type maplibregl from 'maplibre-gl';

export type MapLib = typeof maplibregl;
export interface Engine {
  lib: MapLib;
  kind: 'mapbox' | 'maplibre';
  style: string | maplibregl.StyleSpecification;
  basemapLabel: string;
}

const CARTO_DARK = 'https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json';
export const BLANK_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#101114' } }],
};

async function reachable(url: string, ms = 5000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

export async function loadEngine(): Promise<Engine> {
  const token = (import.meta.env.VITE_MAPBOX_ACCESS_TOKEN as string | undefined)?.trim();
  if (token) {
    if (token.startsWith('sk.')) console.warn('Ignoring a secret Mapbox token (sk.*). Use a public, URL-restricted pk.* token.');
    else if (await reachable(`https://api.mapbox.com/styles/v1/mapbox/dark-v11?access_token=${encodeURIComponent(token)}`)) {
      const mod = await import('mapbox-gl');
      await import('mapbox-gl/dist/mapbox-gl.css');
      const lib = (mod.default ?? mod) as unknown as MapLib & { accessToken: string };
      lib.accessToken = token;
      return { lib, kind: 'mapbox', style: 'mapbox://styles/mapbox/dark-v11', basemapLabel: 'Mapbox Dark' };
    } else console.warn('Mapbox token rejected or Mapbox unreachable; falling back to MapLibre.');
  }
  const mod = await import('maplibre-gl');
  await import('maplibre-gl/dist/maplibre-gl.css');
  const lib = (mod.default ?? mod) as MapLib;
  if (await reachable(CARTO_DARK)) return { lib, kind: 'maplibre', style: CARTO_DARK, basemapLabel: 'CARTO Dark Matter' };
  return { lib, kind: 'maplibre', style: BLANK_STYLE, basemapLabel: 'none (offline)' };
}
