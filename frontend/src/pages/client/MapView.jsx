import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Trees, Maximize, AlertCircle } from 'lucide-react';
import api from '../../api/client';
import LayerController from '../../components/LayerController';

export default function MapView({ projectId, projectInfo }) {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const mapReady = useRef(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [projectData, setProjectData] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const [layers, setLayers] = useState({
    base: 'ortho',
    overlays: {
      boundary: true,
      trees: true,
      health: false,
      height: false,
    },
  });

  const [heightRange, setHeightRange] = useState({ min: 0, max: 15 });

  // Plant-health overlay state
  const [viIndices, setViIndices] = useState([]);
  const [viPalettes, setViPalettes] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState('');
  const [selectedPalette, setSelectedPalette] = useState('rdylgn');
  const [viRange, setViRange] = useState([-1, 1]);

  // Fetch available vegetation indices
  useEffect(() => {
    if (!projectId) return;
    api.get(`/projects/${projectId}/vegetation-indices`)
      .then(res => {
        const data = res.data;
        setViIndices(data.indices || []);
        setViPalettes(data.palettes || []);
        if (data.default_index) {
          setSelectedIndex(data.default_index);
          const idx = (data.indices || []).find(i => i.name === data.default_index);
          if (idx) setViRange(idx.range);
        }
      })
      .catch(err => console.error('Failed to fetch vegetation indices', err));
  }, [projectId]);

  // ── Map initialisation ────────────────────────────────────
  useEffect(() => {
    if (!projectId || !mapContainer.current) return;
    setLoading(true);
    let isMounted = true;

    const initMap = async () => {
      try {
        const [projRes, treeRes] = await Promise.all([
          api.get(`/projects/${projectId}`),
          api.get(`/projects/${projectId}/trees`),
        ]);
        if (!isMounted) return;

        const proj = projRes.data;
        const treesGeoJson = treeRes.data;
        setProjectData(proj);

        const boundary = proj.boundary_geojson ? JSON.parse(proj.boundary_geojson) : null;

        let center = [0, 0];
        let zoom = 2;
        if (boundary?.features?.[0]?.geometry?.coordinates) {
          const coords = boundary.features[0].geometry.coordinates[0];
          const lngs = coords.map(c => c[0]);
          const lats = coords.map(c => c[1]);
          center = [(Math.min(...lngs) + Math.max(...lngs)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];
          zoom = 15;
        }

        map.current = new maplibregl.Map({
          container: mapContainer.current,
          style: {
            version: 8,
            sources: {
              osm: {
                type: 'raster',
                tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'],
                tileSize: 256,
                attribution: '&copy; OpenStreetMap Contributors',
              },
            },
            layers: [{ id: 'osm', type: 'raster', source: 'osm', minzoom: 0, maxzoom: 19 }],
          },
          center,
          zoom,
          antialias: true,
        });

        map.current.addControl(new maplibregl.NavigationControl(), 'top-right');

        map.current.on('load', () => {
          if (!isMounted) return;
          setupSourcesAndLayers(proj, treesGeoJson, boundary);
          mapReady.current = true;
          setLoading(false);
        });
      } catch (err) {
        if (!isMounted) return;
        console.error(err);
        setError('Failed to load map data');
        setLoading(false);
      }
    };

    initMap();

    return () => {
      isMounted = false;
      mapReady.current = false;
      if (map.current) map.current.remove();
    };
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Add all sources & layers ──────────────────────────────
  const setupSourcesAndLayers = (proj, treesGeoJson, boundary) => {
    if (!map.current) return;
    const m = map.current;
    const baseUrl = window.location.origin;
    const pid = proj.id;

    // Raster base layers: ortho, dtm, dsm
    ['ortho', 'dtm', 'dsm'].forEach(type => {
      m.addSource(type, {
        type: 'raster',
        tiles: [`${baseUrl}/tiles/${pid}/${type}/{z}/{x}/{y}.png`],
        tileSize: 256,
        scheme: 'xyz',
        minzoom: 2,
        maxzoom: 22,
      });
      m.addLayer({
        id: `${type}-layer`,
        type: 'raster',
        source: type,
        layout: { visibility: layers.base === type ? 'visible' : 'none' },
      });
    });

    // Vegetation index raster
    m.addSource('vi-tiles', {
      type: 'raster',
      tiles: [`${baseUrl}/tiles/${pid}/vi/{z}/{x}/{y}.png?index=${selectedIndex || 'VARI'}&palette=${selectedPalette}`],
      tileSize: 256,
      scheme: 'xyz',
      minzoom: 2,
      maxzoom: 22,
    });
    m.addLayer({
      id: 'vi-layer',
      type: 'raster',
      source: 'vi-tiles',
      layout: { visibility: layers.base === 'plant-health' ? 'visible' : 'none' },
    });

    // Boundary — added AFTER rasters so it renders on top
    if (boundary) {
      m.addSource('boundary', { type: 'geojson', data: boundary });
      m.addLayer({
        id: 'boundary-line',
        type: 'line',
        source: 'boundary',
        paint: { 'line-color': '#00ffff', 'line-width': 4, 'line-opacity': 0.9 },
        layout: { visibility: layers.overlays.boundary ? 'visible' : 'none' },
      });
    }

    // Trees — async fetch with auth token already done above
    if (treesGeoJson?.features?.length > 0) {
      const heights = treesGeoJson.features
        .map(f => f.properties.height_m)
        .filter(h => h !== null && h !== undefined);

      const min = heights.length > 0 ? Math.min(...heights) : 0;
      const max = heights.length > 0 ? Math.max(...heights) : 15;
      setHeightRange({ min, max });

      m.addSource('trees', { type: 'geojson', data: treesGeoJson });
      setupTreeLayers({ min, max });

      // Fit to trees
      const lngs = treesGeoJson.features.map(f => f.geometry.coordinates[0]);
      const lats = treesGeoJson.features.map(f => f.geometry.coordinates[1]);
      m.fitBounds(
        [[Math.min(...lngs) - 0.001, Math.min(...lats) - 0.001],
         [Math.max(...lngs) + 0.001, Math.max(...lats) + 0.001]],
        { padding: 60, duration: 0 },
      );
    }
  };

  // ── Three separate tree layers ────────────────────────────
  const setupTreeLayers = (range) => {
    if (!map.current) return;
    const m = map.current;
    const { min, max } = range;
    const delta = max - min || 1;

    // 1. Default point layer (white dots)
    m.addLayer({
      id: 'trees-point',
      type: 'circle',
      source: 'trees',
      paint: {
        'circle-radius': 4,
        'circle-color': '#ffffff',
        'circle-stroke-width': 1,
        'circle-stroke-color': '#000000',
      },
      layout: {
        visibility: layers.overlays.trees && !layers.overlays.health && !layers.overlays.height ? 'visible' : 'none',
      },
    });

    // 2. Health classification layer
    m.addLayer({
      id: 'trees-health',
      type: 'circle',
      source: 'trees',
      paint: {
        'circle-radius': 6,
        'circle-color': [
          'match', ['get', 'health_status'],
          'Healthy', '#22c55e',
          'Moderate', '#eab308',
          'Poor', '#ef4444',
          '#64748b',
        ],
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#000000',
      },
      layout: { visibility: layers.overlays.health ? 'visible' : 'none' },
    });

    // 3. Height heatmap layer — size + colour based on height_m
    m.addLayer({
      id: 'trees-height',
      type: 'circle',
      source: 'trees',
      paint: {
        'circle-radius': [
          'interpolate', ['linear'], ['get', 'height_m'],
          min, 8,
          min + delta * 0.5, 12,
          max, 18,
        ],
        'circle-color': [
          'interpolate', ['linear'], ['get', 'height_m'],
          min, '#ffff00',
          min + delta * 0.15, '#ffcc00',
          min + delta * 0.30, '#ff8c00',
          min + delta * 0.45, '#e91e63',
          min + delta * 0.60, '#d81b60',
          min + delta * 0.75, '#8e24aa',
          min + delta * 0.90, '#3f51b5',
          max, '#1a237e',
        ],
        'circle-opacity': 0.85,
        'circle-stroke-width': 1,
        'circle-stroke-color': '#000000',
      },
      layout: { visibility: layers.overlays.height ? 'visible' : 'none' },
    });

    // Click popup on all tree layers
    ['trees-point', 'trees-health', 'trees-height'].forEach(lid => {
      m.on('click', lid, handleTreeClick);
    });

    // Cursor change
    const treeLayers = ['trees-point', 'trees-health', 'trees-height'];
    m.on('mouseenter', treeLayers, () => { m.getCanvas().style.cursor = 'pointer'; });
    m.on('mouseleave', treeLayers, () => { m.getCanvas().style.cursor = ''; });
  };

  // ── Tree popup ────────────────────────────────────────────
  const handleTreeClick = useCallback((e) => {
    if (!map.current) return;
    const features = map.current.queryRenderedFeatures(e.point, {
      layers: ['trees-point', 'trees-health', 'trees-height'],
    });
    if (!features.length) return;
    const tree = features[0].properties;

    new maplibregl.Popup()
      .setLngLat(e.lngLat)
      .setHTML(`
        <div class="tree-popup">
          <div class="tree-popup__header">
            <span class="tree-popup__id">Tree #${tree.tree_index}</span>
          </div>
          <div class="tree-popup__row">
            <span class="tree-popup__label">Height</span>
            <span class="tree-popup__value">${tree.height_m != null ? Number(tree.height_m).toFixed(1) + 'm' : 'N/A'}</span>
          </div>
          <div class="tree-popup__row">
            <span class="tree-popup__label">Health</span>
            <span class="tree-popup__value">${tree.health_status || 'N/A'}</span>
          </div>
          <div class="tree-popup__row">
            <span class="tree-popup__label">Location</span>
            <span class="tree-popup__value" style="font-size:10px">
              ${Number(tree.latitude).toFixed(6)}, ${Number(tree.longitude).toFixed(6)}
            </span>
          </div>
        </div>
      `)
      .addTo(map.current);
  }, []);

  // ── Base layer switching ──────────────────────────────────
  useEffect(() => {
    if (!map.current || !mapReady.current) return;

    ['ortho', 'dtm', 'dsm'].forEach(type => {
      if (map.current.getLayer(`${type}-layer`)) {
        map.current.setLayoutProperty(`${type}-layer`, 'visibility', layers.base === type ? 'visible' : 'none');
      }
    });

    if (map.current.getLayer('vi-layer')) {
      map.current.setLayoutProperty('vi-layer', 'visibility', layers.base === 'plant-health' ? 'visible' : 'none');
    }
  }, [layers.base]);

  // ── Overlay switching ─────────────────────────────────────
  useEffect(() => {
    if (!map.current || !mapReady.current) return;

    if (map.current.getLayer('boundary-line')) {
      map.current.setLayoutProperty('boundary-line', 'visibility', layers.overlays.boundary ? 'visible' : 'none');
    }

    const showBasic = layers.overlays.trees && !layers.overlays.health && !layers.overlays.height;
    if (map.current.getLayer('trees-point')) {
      map.current.setLayoutProperty('trees-point', 'visibility', showBasic ? 'visible' : 'none');
    }
    if (map.current.getLayer('trees-health')) {
      map.current.setLayoutProperty('trees-health', 'visibility', layers.overlays.health ? 'visible' : 'none');
    }
    if (map.current.getLayer('trees-height')) {
      map.current.setLayoutProperty('trees-height', 'visibility', layers.overlays.height ? 'visible' : 'none');
    }
  }, [layers.overlays]);

  // ── Rebuild VI tiles when index / palette changes ─────────
  useEffect(() => {
    if (!map.current || !mapReady.current || !projectId) return;
    if (!selectedIndex) return;

    const baseUrl = window.location.origin;
    const newTileUrl = `${baseUrl}/tiles/${projectId}/vi/{z}/{x}/{y}.png?index=${selectedIndex}&palette=${selectedPalette}`;

    // Update range for legend
    const idx = viIndices.find(i => i.name === selectedIndex);
    if (idx) setViRange(idx.range);

    // Remove & recreate source + layer
    if (map.current.getLayer('vi-layer')) map.current.removeLayer('vi-layer');
    if (map.current.getSource('vi-tiles')) map.current.removeSource('vi-tiles');

    map.current.addSource('vi-tiles', {
      type: 'raster',
      tiles: [newTileUrl],
      tileSize: 256,
      scheme: 'xyz',
      minzoom: 2,
      maxzoom: 22,
    });

    const beforeLayer = map.current.getLayer('boundary-line') ? 'boundary-line' : undefined;
    map.current.addLayer({
      id: 'vi-layer',
      type: 'raster',
      source: 'vi-tiles',
      layout: { visibility: layers.base === 'plant-health' ? 'visible' : 'none' },
    }, beforeLayer);
  }, [selectedIndex, selectedPalette]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Legend gradient ───────────────────────────────────────
  const getLegendGradient = () => {
    const paletteColors = {
      rdylgn: ['#ad0028', '#ff6c4a', '#ffe093', '#fdfec2', '#73ca6f', '#007e47'],
      spectral: ['#9e0142', '#f48d40', '#fefebd', '#94ce70', '#3186ac', '#304399'],
      viridis: ['#440154', '#39508b', '#1e838c', '#37b266', '#a4d224', '#f3e51e'],
      jet: ['#00007f', '#007fff', '#7fff7f', '#ffff00', '#ff3f00', '#7f0000'],
      magma: ['#000004', '#6b1080', '#b6507f', '#f09e49', '#f9dc3f', '#fcfdbf'],
    };
    const colors = paletteColors[selectedPalette] || paletteColors.rdylgn;
    return `linear-gradient(to top, ${colors.join(', ')})`;
  };

  // ── Recenter ──────────────────────────────────────────────
  const handleRecenter = () => {
    if (!map.current || !projectData) return;
    const boundary = projectData.boundary_geojson ? JSON.parse(projectData.boundary_geojson) : null;
    const coords = boundary?.features?.[0]?.geometry?.coordinates?.[0];
    if (coords?.length > 0) {
      const bounds = coords.reduce(
        (acc, coord) => acc.extend(coord),
        new maplibregl.LngLatBounds(coords[0], coords[0]),
      );
      map.current.fitBounds(bounds, { padding: 50, duration: 1000 });
    }
  };

  // ── No project guard ──────────────────────────────────────
  if (!projectId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-12 text-slate-500">
        <AlertCircle size={48} className="text-slate-300 mb-4" />
        <h2 className="text-xl font-heading font-bold text-slate-700">No Project Selected</h2>
        <p className="text-sm">Select a project to view its map layers.</p>
      </div>
    );
  }

  // ── JSX ───────────────────────────────────────────────────
  return (
    <div className="map-container flex-1 bg-slate-50 relative">
      {loading && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-white/50 backdrop-blur-sm">
          <div className="spinner mb-4" />
          <p className="font-semibold text-slate-600">Loading Map Data...</p>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/90">
          <p className="text-red-500 font-bold bg-red-50 px-6 py-3 rounded-xl border border-red-200">{error}</p>
        </div>
      )}

      {/* MapLibre Canvas */}
      <div ref={mapContainer} className="map-canvas" />

      {/* Map Layers Sidebar */}
      {!loading && !error && (
        <LayerController
          layers={layers}
          setLayers={setLayers}
          viIndices={viIndices}
          viPalettes={viPalettes}
          selectedIndex={selectedIndex}
          selectedPalette={selectedPalette}
          onIndexChange={setSelectedIndex}
          onPaletteChange={setSelectedPalette}
          isCollapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        />
      )}

      {/* Floating Recenter Action */}
      <button
        onClick={handleRecenter}
        className="absolute bottom-20 right-6 z-10 w-10 h-10 bg-white/90 backdrop-blur border border-slate-200 rounded-xl shadow-glass flex items-center justify-center text-slate-600 hover:text-primary-600 focus:outline-none transition-colors"
        title="Recenter Map"
      >
        <Maximize size={18} />
      </button>

      {/* Bottom Info Bar */}
      <div className="absolute bottom-0 left-0 right-0 z-20 h-14 bg-white/80 backdrop-blur-xl border-t border-white/90 shadow-[0_-4px_24px_rgba(0,0,0,0.04)] flex items-center justify-between px-6">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-primary-500 shadow-green-glow" />
            <span className="text-sm font-semibold text-slate-800 tracking-tight">{projectData?.name || 'Loading...'}</span>
          </div>
          <div className="h-4 w-px bg-slate-300" />
          <div className="flex flex-col">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Area</span>
            <span className="text-xs font-semibold text-slate-600">{projectData?.area_ha ? `${projectData.area_ha.toFixed(2)} ha` : '—'}</span>
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-2.5 bg-white border border-slate-200 px-3 py-1.5 rounded-full shadow-sm">
          <Trees size={14} className="text-primary-600" />
          <span className="text-xs font-semibold text-slate-700">Trees mapped</span>
        </div>
      </div>

      {/* ── Height Legend ─────────────────────────────────── */}
      {layers.overlays.height && (
        <div className="map-legend animate-fade-in" style={{ bottom: '70px', right: '24px' }}>
          <div className="map-legend__title">Tree Height (m)</div>
          <div className="map-legend__gradient">
            <div className="map-legend__bar" />
            <div className="map-legend__labels">
              <span>{heightRange.max.toFixed(1)}+</span>
              <span>{(heightRange.min + (heightRange.max - heightRange.min) * 0.85).toFixed(1)}</span>
              <span>{(heightRange.min + (heightRange.max - heightRange.min) * 0.71).toFixed(1)}</span>
              <span>{(heightRange.min + (heightRange.max - heightRange.min) * 0.57).toFixed(1)}</span>
              <span>{(heightRange.min + (heightRange.max - heightRange.min) * 0.42).toFixed(1)}</span>
              <span>{(heightRange.min + (heightRange.max - heightRange.min) * 0.28).toFixed(1)}</span>
              <span>{(heightRange.min + (heightRange.max - heightRange.min) * 0.14).toFixed(1)}</span>
              <span>{heightRange.min.toFixed(1)}</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Health Legend ─────────────────────────────────── */}
      {layers.overlays.health && (
        <div className="map-legend vi-legend animate-fade-in" style={{ bottom: '70px', right: layers.overlays.height ? '160px' : '24px' }}>
          <div className="map-legend__title">Health Status</div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-xs text-slate-600 font-medium">
              <span className="w-3 h-3 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" /> Healthy
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-600 font-medium">
              <span className="w-3 h-3 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.4)]" /> Moderate
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-600 font-medium">
              <span className="w-3 h-3 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]" /> Poor
            </div>
          </div>
        </div>
      )}

      {/* ── VI Legend ─────────────────────────────────────── */}
      {layers.base === 'plant-health' && selectedIndex && (
        <div className="map-legend vi-legend animate-fade-in" style={{ bottom: '70px', right: layers.overlays.height ? '280px' : '24px' }}>
          <div className="map-legend__title">
            {viIndices.find(i => i.name === selectedIndex)?.label || selectedIndex}
          </div>
          <div className="map-legend__gradient">
            <div className="map-legend__bar" style={{ background: getLegendGradient() }} />
            <div className="map-legend__labels">
              <span>{viRange[1]}</span>
              <span>{((viRange[0] + viRange[1]) / 2).toFixed(2)}</span>
              <span>{viRange[0]}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
