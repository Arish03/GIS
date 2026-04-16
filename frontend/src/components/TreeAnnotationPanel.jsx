import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { TreePine, Clock, Ruler, Pencil, Plus, Check, Save, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/client';

export default function TreeAnnotationPanel({ projectId }) {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const [trees, setTrees] = useState(null);
  const [treeCount, setTreeCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [drawMode, setDrawMode] = useState(false);
  const [firstCorner, setFirstCorner] = useState(null);
  const [calculating, setCalculating] = useState(false);
  const [deleting, setDeleting] = useState(null);

  // Bbox interaction state
  const [selectedBbox, setSelectedBbox] = useState(null);   // tree id of selected bbox
  const [dragState, setDragState] = useState(null);          // { type: 'move'|'resize', corner?, startLngLat, origBbox }
  const drawModeRef = useRef(false);
  const firstCornerRef = useRef(null);
  const selectedBboxRef = useRef(null);
  const dragStateRef = useRef(null);
  const treesRef = useRef(null);
  // Boundary draw state
  const [boundaryMode, setBoundaryMode] = useState(false);
  const [boundaryVertices, setBoundaryVertices] = useState([]);
  const [drawnBoundary, setDrawnBoundary] = useState(null); // completed GeoJSON polygon
  const [savingBoundary, setSavingBoundary] = useState(false);
  const boundaryModeRef = useRef(false);
  const boundaryVerticesRef = useRef([]);
  useEffect(() => { drawModeRef.current = drawMode; }, [drawMode]);
  useEffect(() => { firstCornerRef.current = firstCorner; }, [firstCorner]);
  useEffect(() => { selectedBboxRef.current = selectedBbox; }, [selectedBbox]);
  useEffect(() => { dragStateRef.current = dragState; }, [dragState]);
  useEffect(() => { treesRef.current = trees; }, [trees]);
  useEffect(() => { boundaryModeRef.current = boundaryMode; }, [boundaryMode]);
  useEffect(() => { boundaryVerticesRef.current = boundaryVertices; }, [boundaryVertices]);

  // Load trees
  const loadTrees = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await api.get(`/projects/${projectId}/trees`);
      const data = res.data;
      setTrees(data);
      setTreeCount(data.features?.length || 0);
      const pending = (data.features || []).filter(
        f => f.properties.detection_source === 'manual' && f.properties.height_m == null
      ).length;
      setPendingCount(pending);
      return data;
    } catch (err) {
      console.error('Failed to load trees', err);
    }
  }, [projectId]);

  // Init map
  useEffect(() => {
    if (!mapContainer.current || !projectId) return;

    const baseUrl = window.location.origin;

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
        layers: [
          { id: 'osm', type: 'raster', source: 'osm', minzoom: 0, maxzoom: 19 },
        ],
      },
      center: [0, 0],
      zoom: 2,
      antialias: true,
      dragRotate: false,
      pitchWithRotate: false,
      touchZoomRotate: true,
    });

    // Disable right-click rotation
    map.current.dragRotate.disable();
    map.current.touchZoomRotate.disableRotation();
    map.current.keyboard.disableRotation();

    // Disable context menu
    map.current.getCanvas().addEventListener('contextmenu', (e) => e.preventDefault());

    map.current.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    map.current.on('load', async () => {
      // Ensure canvas dimensions are correct after CSS layout is applied
      map.current.resize();

      // Ortho tiles
      map.current.addSource('ortho', {
        type: 'raster',
        tiles: [`${baseUrl}/tiles/${projectId}/ortho/{z}/{x}/{y}.png`],
        tileSize: 256,
        scheme: 'xyz',
        minzoom: 2,
        maxzoom: 22,
      });
      map.current.addLayer({ id: 'ortho-layer', type: 'raster', source: 'ortho' });

      const treeData = await loadTrees();
      if (treeData && treeData.features?.length > 0) {
        addTreeLayers(treeData);
        fitToTrees(treeData);
      }

      await loadExistingBoundary(!(treeData?.features?.length > 0));
      setupInteraction();
    });

    return () => {
      if (map.current) map.current.remove();
    };
  }, [projectId]);

  // ── Layers ─────────────────────────────────────
  const addTreeLayers = (data) => {
    if (!map.current) return;

    if (map.current.getSource('trees')) {
      map.current.getSource('trees').setData(data);
      updateBboxSource(data);
      return;
    }

    map.current.addSource('trees', { type: 'geojson', data });

    // Tree circles
    map.current.addLayer({
      id: 'trees-circles',
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
        'circle-stroke-color': '#000',
      },
    });

    // Bbox polygons source
    updateBboxSource(data);
  };

  const updateBboxSource = (data) => {
    const bboxFeatures = (data.features || [])
      .filter(f => f.properties.bbox_tl_lat != null)
      .map(f => {
        const p = f.properties;
        return {
          type: 'Feature',
          properties: { id: p.id, tree_index: p.tree_index, detection_source: p.detection_source, height_m: p.height_m },
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [p.bbox_tl_lon, p.bbox_tl_lat],
              [p.bbox_tr_lon, p.bbox_tr_lat],
              [p.bbox_br_lon, p.bbox_br_lat],
              [p.bbox_bl_lon, p.bbox_bl_lat],
              [p.bbox_tl_lon, p.bbox_tl_lat],
            ]],
          },
        };
      });

    const bboxGeoJSON = { type: 'FeatureCollection', features: bboxFeatures };

    if (map.current.getSource('tree-bboxes')) {
      map.current.getSource('tree-bboxes').setData(bboxGeoJSON);
    } else {
      map.current.addSource('tree-bboxes', { type: 'geojson', data: bboxGeoJSON });

      map.current.addLayer({
        id: 'bbox-fill',
        type: 'fill',
        source: 'tree-bboxes',
        paint: {
          'fill-color': [
            'case',
            ['==', ['get', 'height_m'], null], 'rgba(255,165,0,0.15)',
            'rgba(34,197,94,0.08)',
          ],
          'fill-opacity': 0.6,
        },
      });

      map.current.addLayer({
        id: 'bbox-outline',
        type: 'line',
        source: 'tree-bboxes',
        paint: {
          'line-color': [
            'case',
            ['==', ['get', 'height_m'], null], '#f59e0b',
            '#22c55e',
          ],
          'line-width': 1.5,
          'line-dasharray': [3, 2],
        },
      });
    }

    // Selected bbox highlight
    const selId = selectedBboxRef.current;
    updateSelectedBboxHighlight(selId, bboxFeatures);

    // Corner handles
    updateCornerHandles(selId, bboxFeatures);
  };

  const updateSelectedBboxHighlight = (selId, bboxFeatures) => {
    const selFeature = selId ? bboxFeatures.find(f => f.properties.id === selId) : null;
    const selData = selFeature
      ? { type: 'FeatureCollection', features: [selFeature] }
      : { type: 'FeatureCollection', features: [] };

    if (map.current.getSource('selected-bbox')) {
      map.current.getSource('selected-bbox').setData(selData);
    } else {
      map.current.addSource('selected-bbox', { type: 'geojson', data: selData });
      map.current.addLayer({
        id: 'selected-bbox-outline',
        type: 'line',
        source: 'selected-bbox',
        paint: { 'line-color': '#38bdf8', 'line-width': 2.5 },
      });
    }
  };

  const updateCornerHandles = (selId, bboxFeatures) => {
    const selFeature = selId ? bboxFeatures.find(f => f.properties.id === selId) : null;
    let handleFeatures = [];
    if (selFeature) {
      const coords = selFeature.geometry.coordinates[0];
      // corners: TL=0, TR=1, BR=2, BL=3
      const labels = ['tl', 'tr', 'br', 'bl'];
      handleFeatures = coords.slice(0, 4).map((c, i) => ({
        type: 'Feature',
        properties: { corner: labels[i], bbox_id: selId },
        geometry: { type: 'Point', coordinates: c },
      }));
    }
    const handleData = { type: 'FeatureCollection', features: handleFeatures };

    if (map.current.getSource('corner-handles')) {
      map.current.getSource('corner-handles').setData(handleData);
    } else {
      map.current.addSource('corner-handles', { type: 'geojson', data: handleData });
      map.current.addLayer({
        id: 'corner-handles-layer',
        type: 'circle',
        source: 'corner-handles',
        paint: {
          'circle-radius': 5,
          'circle-color': '#38bdf8',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#fff',
        },
      });
    }
  };

  const fitToTrees = (data) => {
    if (!data?.features?.length) return;
    const coords = data.features.map(f => f.geometry.coordinates);
    const lngs = coords.map(c => c[0]);
    const lats = coords.map(c => c[1]);
    map.current.fitBounds(
      [[Math.min(...lngs) - 0.001, Math.min(...lats) - 0.001],
       [Math.max(...lngs) + 0.001, Math.max(...lats) + 0.001]],
      { padding: 50 }
    );
  };

  // ── Boundary drawing ───────────────────────────

  const loadExistingBoundary = async (fitMap = false) => {
    try {
      const res = await api.get(`/projects/${projectId}`);
      const proj = res.data;
      if (proj.boundary_geojson) {
        const geojson = JSON.parse(proj.boundary_geojson);
        setDrawnBoundary(geojson);
        showBoundaryOnMap(geojson);

        // Fit map to boundary if no trees were loaded
        if (fitMap && map.current) {
          const coords = [];
          const extractCoords = (g) => {
            if (g.type === 'FeatureCollection') (g.features || []).forEach(f => extractCoords(f));
            else if (g.type === 'Feature') extractCoords(g.geometry);
            else if (g.type === 'Polygon') g.coordinates[0].forEach(c => coords.push(c));
            else if (g.type === 'MultiPolygon') g.coordinates.forEach(p => p[0].forEach(c => coords.push(c)));
          };
          extractCoords(geojson);
          if (coords.length > 0) {
            const lngs = coords.map(c => c[0]);
            const lats = coords.map(c => c[1]);
            map.current.fitBounds(
              [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
              { padding: 50 }
            );
          }
        }
      }
    } catch (err) {
      console.error('Failed to load boundary', err);
    }
  };

  const showBoundaryOnMap = (geojson) => {
    if (!map.current) return;
    if (map.current.getSource('drawn-boundary')) {
      map.current.getSource('drawn-boundary').setData(geojson);
    } else {
      map.current.addSource('drawn-boundary', { type: 'geojson', data: geojson });
      map.current.addLayer({
        id: 'drawn-boundary-fill',
        type: 'fill',
        source: 'drawn-boundary',
        paint: { 'fill-color': '#00ffff', 'fill-opacity': 0.08 },
      });
      map.current.addLayer({
        id: 'drawn-boundary-line',
        type: 'line',
        source: 'drawn-boundary',
        paint: { 'line-color': '#00ffff', 'line-width': 3, 'line-opacity': 0.9 },
      });
    }
  };

  const updateBoundaryPreview = (vertices) => {
    if (!map.current) return;

    // Vertex markers
    const vertexData = {
      type: 'FeatureCollection',
      features: vertices.map((v, i) => ({
        type: 'Feature',
        properties: { index: i },
        geometry: { type: 'Point', coordinates: v },
      })),
    };

    if (map.current.getSource('boundary-vertices')) {
      map.current.getSource('boundary-vertices').setData(vertexData);
    } else {
      map.current.addSource('boundary-vertices', { type: 'geojson', data: vertexData });
      map.current.addLayer({
        id: 'boundary-vertices-layer',
        type: 'circle',
        source: 'boundary-vertices',
        paint: {
          'circle-radius': 5,
          'circle-color': '#00ffff',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#fff',
        },
      });
    }

    // Line connecting vertices
    const lineCoords = vertices.length >= 2 ? vertices : [];
    const lineData = {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: lineCoords.length >= 2 ? lineCoords : [[0,0],[0,0]] },
    };

    if (map.current.getSource('boundary-lines')) {
      map.current.getSource('boundary-lines').setData(lineData);
    } else {
      map.current.addSource('boundary-lines', { type: 'geojson', data: lineData });
      map.current.addLayer({
        id: 'boundary-lines-layer',
        type: 'line',
        source: 'boundary-lines',
        paint: { 'line-color': '#00ffff', 'line-width': 2, 'line-dasharray': [4, 2] },
      });
    }

    if (lineCoords.length < 2 && map.current.getLayer('boundary-lines-layer')) {
      map.current.setLayoutProperty('boundary-lines-layer', 'visibility', 'none');
    } else if (map.current.getLayer('boundary-lines-layer')) {
      map.current.setLayoutProperty('boundary-lines-layer', 'visibility', 'visible');
    }
  };

  const removeBoundaryPreview = () => {
    if (!map.current) return;
    ['boundary-vertices-layer', 'boundary-lines-layer'].forEach(id => {
      if (map.current.getLayer(id)) map.current.removeLayer(id);
    });
    ['boundary-vertices', 'boundary-lines'].forEach(id => {
      if (map.current.getSource(id)) map.current.removeSource(id);
    });
  };

  const handleBoundaryClick = (e) => {
    if (!boundaryModeRef.current) return;

    const verts = [...boundaryVerticesRef.current];
    const newPt = [e.lngLat.lng, e.lngLat.lat];

    // Close polygon if clicking near the first vertex (> 3 vertices)
    if (verts.length >= 3) {
      const first = verts[0];
      const dist = Math.sqrt(
        Math.pow(newPt[0] - first[0], 2) + Math.pow(newPt[1] - first[1], 2)
      );
      // Close if within ~20px equivalent (small geo distance)
      const zoom = map.current.getZoom();
      const threshold = 0.0005 * Math.pow(2, 18 - zoom); // adaptive threshold
      if (dist < threshold) {
        finishBoundary(verts);
        return;
      }
    }

    verts.push(newPt);
    setBoundaryVertices(verts);
    updateBoundaryPreview(verts);
  };

  const finishBoundary = (verts) => {
    if (verts.length < 3) return;

    const closed = [...verts, verts[0]];
    const geojson = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [closed] },
      }],
    };

    setDrawnBoundary(geojson);
    setBoundaryMode(false);
    setBoundaryVertices([]);
    removeBoundaryPreview();
    showBoundaryOnMap(geojson);
  };

  const cancelBoundaryDraw = () => {
    setBoundaryMode(false);
    setBoundaryVertices([]);
    removeBoundaryPreview();
  };

  const clearBoundary = () => {
    setDrawnBoundary(null);
    if (!map.current) return;
    ['drawn-boundary-fill', 'drawn-boundary-line'].forEach(id => {
      if (map.current.getLayer(id)) map.current.removeLayer(id);
    });
    if (map.current.getSource('drawn-boundary')) {
      map.current.removeSource('drawn-boundary');
    }
  };

  const handleSaveBoundary = async () => {
    if (!drawnBoundary) return;
    setSavingBoundary(true);
    try {
      const res = await api.post(`/projects/${projectId}/boundary`, {
        geojson: drawnBoundary,
      });
      // Reload trees (some may have been removed)
      const data = await loadTrees();
      if (data && map.current?.getSource('trees')) addTreeLayers(data);
      toast.success(`Boundary saved! ${res.data.trees_removed} trees removed, ${res.data.trees_remaining} remaining.`);
    } catch (err) {
      console.error('Failed to save boundary', err);
      toast.error('Failed to save boundary');
    } finally {
      setSavingBoundary(false);
    }
  };

  // ── Interaction Setup ──────────────────────────
  const setupInteraction = () => {
    if (!map.current) return;

    // Tree circle click → popup
    map.current.on('click', 'trees-circles', (e) => {
      if (drawModeRef.current || dragStateRef.current || boundaryModeRef.current) return;
      const feat = e.features[0];
      const props = feat.properties;
      const coords = feat.geometry.coordinates;

      const popup = new maplibregl.Popup({ closeOnClick: true, maxWidth: '240px' })
        .setLngLat(coords)
        .setHTML(`
          <div class="tree-popup">
            <div class="tree-popup__header">
              <span class="tree-popup__id">Tree #${props.tree_index}</span>
              <span style="font-size:10px;color:#94a3b8">${props.detection_source || 'auto'}</span>
            </div>
            <div class="tree-popup__row">
              <span class="tree-popup__label">Height</span>
              <span class="tree-popup__value">${props.height_m != null ? props.height_m + 'm' : 'Pending'}</span>
            </div>
            <div class="tree-popup__row">
              <span class="tree-popup__label">Health</span>
              <span class="tree-popup__value">${props.health_status || 'Pending'}</span>
            </div>
            <div class="tree-popup__row">
              <span class="tree-popup__label">Confidence</span>
              <span class="tree-popup__value">${props.confidence != null ? (props.confidence * 100).toFixed(0) + '%' : 'manual'}</span>
            </div>
            <button id="delete-tree-${props.id}" class="tree-popup__delete"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>Remove Tree</button>
          </div>
        `);

      popup.addTo(map.current);

      // Attach delete handler after popup is in the DOM
      setTimeout(() => {
        const btn = document.getElementById(`delete-tree-${props.id}`);
        if (btn) {
          btn.onclick = async () => {
            popup.remove();
            try {
              await api.delete(`/projects/${projectId}/trees/${props.id}`);
              const data = await loadTrees();
              if (data && map.current?.getSource('trees')) addTreeLayers(data);
            } catch (err) {
              console.error('Failed to delete tree', err);
            }
          };
        }
      }, 0);

      e.originalEvent.stopPropagation();
    });

    // Bbox fill click → select for move/resize
    map.current.on('click', 'bbox-fill', (e) => {
      if (drawModeRef.current || dragStateRef.current || boundaryModeRef.current) return;
      const feat = e.features[0];
      const treeId = feat.properties.id;
      setSelectedBbox(prev => prev === treeId ? null : treeId);
      e.originalEvent.stopPropagation();
    });

    // Click on empty space → deselect
    map.current.on('click', (e) => {
      if (boundaryModeRef.current) {
        handleBoundaryClick(e);
        return;
      }
      if (drawModeRef.current) {
        handleDrawClick(e);
        return;
      }
      // Check if clicked on any interactive layer
      const bboxHits = map.current.queryRenderedFeatures(e.point, { layers: ['bbox-fill'] });
      const treeHits = map.current.queryRenderedFeatures(e.point, { layers: ['trees-circles'] });
      const handleHits = map.current.queryRenderedFeatures(e.point, { layers: ['corner-handles-layer'] });
      if (!bboxHits.length && !treeHits.length && !handleHits.length && !dragStateRef.current) {
        setSelectedBbox(null);
      }
    });

    // ── Drag: corner handle (resize) or bbox body (move) ─────
    map.current.on('mousedown', 'corner-handles-layer', (e) => {
      if (drawModeRef.current || boundaryModeRef.current) return;
      e.preventDefault();
      const feat = e.features[0];
      const corner = feat.properties.corner;
      const bboxId = feat.properties.bbox_id;
      const origBbox = getBboxFromTrees(bboxId);
      if (!origBbox) return;

      map.current.dragPan.disable();
      setDragState({ type: 'resize', corner, bboxId, startLngLat: e.lngLat, origBbox });
      e.originalEvent.stopPropagation();
    });

    map.current.on('mousedown', 'bbox-fill', (e) => {
      if (drawModeRef.current || dragStateRef.current || boundaryModeRef.current) return;
      const feat = e.features[0];
      const bboxId = feat.properties.id;
      if (bboxId !== selectedBboxRef.current) return; // only drag selected
      const origBbox = getBboxFromTrees(bboxId);
      if (!origBbox) return;

      map.current.dragPan.disable();
      setDragState({ type: 'move', bboxId, startLngLat: e.lngLat, origBbox });
      e.originalEvent.stopPropagation();
    });

    map.current.on('mousemove', (e) => {
      const ds = dragStateRef.current;
      if (!ds) {
        // Cursor hints
        if (boundaryModeRef.current) {
          map.current.getCanvas().style.cursor = 'crosshair';
          return;
        }
        if (drawModeRef.current) {
          map.current.getCanvas().style.cursor = 'crosshair';
          return;
        }
        const handleHits = map.current.queryRenderedFeatures(e.point, { layers: ['corner-handles-layer'] });
        if (handleHits.length) {
          map.current.getCanvas().style.cursor = 'nwse-resize';
          return;
        }
        const bboxHits = map.current.queryRenderedFeatures(e.point, { layers: ['bbox-fill'] });
        if (bboxHits.length && bboxHits[0].properties.id === selectedBboxRef.current) {
          map.current.getCanvas().style.cursor = 'move';
          return;
        }
        const treeHits = map.current.queryRenderedFeatures(e.point, { layers: ['trees-circles'] });
        map.current.getCanvas().style.cursor = treeHits.length ? 'pointer' : '';
        return;
      }

      // Handle drag
      if (drawModeRef.current) return; // draw handles via handleMouseMove

      const dLng = e.lngLat.lng - ds.startLngLat.lng;
      const dLat = e.lngLat.lat - ds.startLngLat.lat;
      const ob = ds.origBbox;

      let newBbox;
      if (ds.type === 'move') {
        newBbox = {
          tl_lat: ob.tl_lat + dLat, tl_lon: ob.tl_lon + dLng,
          tr_lat: ob.tr_lat + dLat, tr_lon: ob.tr_lon + dLng,
          br_lat: ob.br_lat + dLat, br_lon: ob.br_lon + dLng,
          bl_lat: ob.bl_lat + dLat, bl_lon: ob.bl_lon + dLng,
        };
      } else {
        // resize — move the dragged corner
        newBbox = { ...ob };
        const c = ds.corner;
        if (c === 'tl') {
          newBbox.tl_lat = ob.tl_lat + dLat; newBbox.tl_lon = ob.tl_lon + dLng;
          newBbox.bl_lon = ob.bl_lon + dLng; newBbox.tr_lat = ob.tr_lat + dLat;
        } else if (c === 'tr') {
          newBbox.tr_lat = ob.tr_lat + dLat; newBbox.tr_lon = ob.tr_lon + dLng;
          newBbox.br_lon = ob.br_lon + dLng; newBbox.tl_lat = ob.tl_lat + dLat;
        } else if (c === 'br') {
          newBbox.br_lat = ob.br_lat + dLat; newBbox.br_lon = ob.br_lon + dLng;
          newBbox.tr_lon = ob.tr_lon + dLng; newBbox.bl_lat = ob.bl_lat + dLat;
        } else if (c === 'bl') {
          newBbox.bl_lat = ob.bl_lat + dLat; newBbox.bl_lon = ob.bl_lon + dLng;
          newBbox.tl_lon = ob.tl_lon + dLng; newBbox.br_lat = ob.br_lat + dLat;
        }
      }

      // Live update on map
      previewBboxUpdate(ds.bboxId, newBbox);
    });

    map.current.on('mouseup', async (e) => {
      const ds = dragStateRef.current;
      if (!ds) return;

      map.current.dragPan.enable();

      const dLng = e.lngLat.lng - ds.startLngLat.lng;
      const dLat = e.lngLat.lat - ds.startLngLat.lat;

      // Skip if barely moved
      if (Math.abs(dLng) < 0.000001 && Math.abs(dLat) < 0.000001) {
        setDragState(null);
        return;
      }

      const ob = ds.origBbox;
      let newBbox;
      if (ds.type === 'move') {
        newBbox = {
          tl_lat: ob.tl_lat + dLat, tl_lon: ob.tl_lon + dLng,
          tr_lat: ob.tr_lat + dLat, tr_lon: ob.tr_lon + dLng,
          br_lat: ob.br_lat + dLat, br_lon: ob.br_lon + dLng,
          bl_lat: ob.bl_lat + dLat, bl_lon: ob.bl_lon + dLng,
        };
      } else {
        newBbox = { ...ob };
        const c = ds.corner;
        if (c === 'tl') {
          newBbox.tl_lat = ob.tl_lat + dLat; newBbox.tl_lon = ob.tl_lon + dLng;
          newBbox.bl_lon = ob.bl_lon + dLng; newBbox.tr_lat = ob.tr_lat + dLat;
        } else if (c === 'tr') {
          newBbox.tr_lat = ob.tr_lat + dLat; newBbox.tr_lon = ob.tr_lon + dLng;
          newBbox.br_lon = ob.br_lon + dLng; newBbox.tl_lat = ob.tl_lat + dLat;
        } else if (c === 'br') {
          newBbox.br_lat = ob.br_lat + dLat; newBbox.br_lon = ob.br_lon + dLng;
          newBbox.tr_lon = ob.tr_lon + dLng; newBbox.bl_lat = ob.bl_lat + dLat;
        } else if (c === 'bl') {
          newBbox.bl_lat = ob.bl_lat + dLat; newBbox.bl_lon = ob.bl_lon + dLng;
          newBbox.tl_lon = ob.tl_lon + dLng; newBbox.br_lat = ob.br_lat + dLat;
        }
      }

      setDragState(null);

      // Save to backend
      try {
        await api.put(`/projects/${projectId}/trees/${ds.bboxId}/bbox`, newBbox);
        const data = await loadTrees();
        if (data && map.current?.getSource('trees')) {
          addTreeLayers(data);
        }
      } catch (err) {
        console.error('Failed to update bbox', err);
        // Revert visual
        const data = await loadTrees();
        if (data && map.current?.getSource('trees')) addTreeLayers(data);
      }
    });

    // Draw mode mouse move (preview box)
    map.current.on('mousemove', handleDrawMouseMove);
  };

  const getBboxFromTrees = (treeId) => {
    const data = treesRef.current;
    if (!data) return null;
    const feat = data.features.find(f => f.properties.id === treeId);
    if (!feat) return null;
    const p = feat.properties;
    return {
      tl_lat: p.bbox_tl_lat, tl_lon: p.bbox_tl_lon,
      tr_lat: p.bbox_tr_lat, tr_lon: p.bbox_tr_lon,
      br_lat: p.bbox_br_lat, br_lon: p.bbox_br_lon,
      bl_lat: p.bbox_bl_lat, bl_lon: p.bbox_bl_lon,
    };
  };

  const previewBboxUpdate = (treeId, bbox) => {
    // Update bbox-fill + selected-bbox + corner-handles visually
    const data = treesRef.current;
    if (!data) return;
    const bboxFeatures = (data.features || [])
      .filter(f => f.properties.bbox_tl_lat != null)
      .map(f => {
        const p = f.properties;
        if (p.id === treeId) {
          return {
            type: 'Feature',
            properties: { id: p.id, tree_index: p.tree_index, detection_source: p.detection_source, height_m: p.height_m },
            geometry: {
              type: 'Polygon',
              coordinates: [[
                [bbox.tl_lon, bbox.tl_lat],
                [bbox.tr_lon, bbox.tr_lat],
                [bbox.br_lon, bbox.br_lat],
                [bbox.bl_lon, bbox.bl_lat],
                [bbox.tl_lon, bbox.tl_lat],
              ]],
            },
          };
        }
        return {
          type: 'Feature',
          properties: { id: p.id, tree_index: p.tree_index, detection_source: p.detection_source, height_m: p.height_m },
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [p.bbox_tl_lon, p.bbox_tl_lat],
              [p.bbox_tr_lon, p.bbox_tr_lat],
              [p.bbox_br_lon, p.bbox_br_lat],
              [p.bbox_bl_lon, p.bbox_bl_lat],
              [p.bbox_tl_lon, p.bbox_tl_lat],
            ]],
          },
        };
      });

    if (map.current.getSource('tree-bboxes')) {
      map.current.getSource('tree-bboxes').setData({ type: 'FeatureCollection', features: bboxFeatures });
    }

    // Update selected + corners
    const selFeat = bboxFeatures.find(f => f.properties.id === treeId);
    if (selFeat && map.current.getSource('selected-bbox')) {
      map.current.getSource('selected-bbox').setData({ type: 'FeatureCollection', features: [selFeat] });
    }
    if (selFeat && map.current.getSource('corner-handles')) {
      const coords = selFeat.geometry.coordinates[0];
      const labels = ['tl', 'tr', 'br', 'bl'];
      const handles = coords.slice(0, 4).map((c, i) => ({
        type: 'Feature',
        properties: { corner: labels[i], bbox_id: treeId },
        geometry: { type: 'Point', coordinates: c },
      }));
      map.current.getSource('corner-handles').setData({ type: 'FeatureCollection', features: handles });
    }
  };

  // ── Draw Mode ──────────────────────────────────
  const handleDrawClick = (e) => {
    const corner = firstCornerRef.current;
    if (!corner) {
      setFirstCorner(e.lngLat);
    } else {
      const sw = { lng: Math.min(corner.lng, e.lngLat.lng), lat: Math.min(corner.lat, e.lngLat.lat) };
      const ne = { lng: Math.max(corner.lng, e.lngLat.lng), lat: Math.max(corner.lat, e.lngLat.lat) };
      handleCreateBbox(sw, ne);
      setFirstCorner(null);
      removeDrawBox();
    }
  };

  const handleDrawMouseMove = (e) => {
    const corner = firstCornerRef.current;
    if (!drawModeRef.current || !corner) return;

    const sw = { lng: Math.min(corner.lng, e.lngLat.lng), lat: Math.min(corner.lat, e.lngLat.lat) };
    const ne = { lng: Math.max(corner.lng, e.lngLat.lng), lat: Math.max(corner.lat, e.lngLat.lat) };

    const geojson = {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [sw.lng, sw.lat], [ne.lng, sw.lat],
          [ne.lng, ne.lat], [sw.lng, ne.lat],
          [sw.lng, sw.lat],
        ]],
      },
    };

    if (map.current.getSource('draw-box')) {
      map.current.getSource('draw-box').setData(geojson);
    } else {
      map.current.addSource('draw-box', { type: 'geojson', data: geojson });
      map.current.addLayer({
        id: 'draw-box-fill',
        type: 'fill',
        source: 'draw-box',
        paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.2 },
      });
      map.current.addLayer({
        id: 'draw-box-line',
        type: 'line',
        source: 'draw-box',
        paint: { 'line-color': '#f59e0b', 'line-width': 2, 'line-dasharray': [3, 2] },
      });
    }
  };

  const removeDrawBox = () => {
    if (!map.current) return;
    if (map.current.getLayer('draw-box-fill')) map.current.removeLayer('draw-box-fill');
    if (map.current.getLayer('draw-box-line')) map.current.removeLayer('draw-box-line');
    if (map.current.getSource('draw-box')) map.current.removeSource('draw-box');
  };

  const cancelDraw = () => {
    setFirstCorner(null);
    removeDrawBox();
  };

  // ── Update layers when selectedBbox changes ────
  useEffect(() => {
    if (!map.current || !map.current.isStyleLoaded() || !trees) return;
    const bboxFeatures = (trees.features || [])
      .filter(f => f.properties.bbox_tl_lat != null)
      .map(f => {
        const p = f.properties;
        return {
          type: 'Feature',
          properties: { id: p.id, tree_index: p.tree_index, detection_source: p.detection_source, height_m: p.height_m },
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [p.bbox_tl_lon, p.bbox_tl_lat],
              [p.bbox_tr_lon, p.bbox_tr_lat],
              [p.bbox_br_lon, p.bbox_br_lat],
              [p.bbox_bl_lon, p.bbox_bl_lat],
              [p.bbox_tl_lon, p.bbox_tl_lat],
            ]],
          },
        };
      });
    updateSelectedBboxHighlight(selectedBbox, bboxFeatures);
    updateCornerHandles(selectedBbox, bboxFeatures);
  }, [selectedBbox, trees]);

  // ── Create bbox-only tree ─────────────────────
  const handleCreateBbox = async (sw, ne) => {
    try {
      await api.post(`/projects/${projectId}/trees/manual/bbox`, {
        tl_lat: ne.lat, tl_lon: sw.lng,
        tr_lat: ne.lat, tr_lon: ne.lng,
        br_lat: sw.lat, br_lon: ne.lng,
        bl_lat: sw.lat, bl_lon: sw.lng,
      });
      const data = await loadTrees();
      if (data && map.current?.getSource('trees')) addTreeLayers(data);
    } catch (err) {
      console.error('Failed to create bbox tree', err);
    }
  };

  // ── Calculate Heights ─────────────────────────
  const handleCalculateHeights = async () => {
    setCalculating(true);
    try {
      const res = await api.post(`/projects/${projectId}/trees/calculate-heights`);
      const data = await loadTrees();
      if (data && map.current?.getSource('trees')) addTreeLayers(data);
    } catch (err) {
      console.error('Failed to calculate heights', err);
    } finally {
      setCalculating(false);
    }
  };

  // ── Delete tree ───────────────────────────────
  const handleDeleteTree = async (treeId) => {
    setDeleting(treeId);
    try {
      await api.delete(`/projects/${projectId}/trees/${treeId}`);
      if (selectedBbox === treeId) setSelectedBbox(null);
      const data = await loadTrees();
      if (data && map.current?.getSource('trees')) addTreeLayers(data);
    } catch (err) {
      console.error('Failed to delete tree', err);
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="annotation-panel">
      {/* Toolbar */}
      <div className="annotation-toolbar">
        <div className="annotation-toolbar__left">
          <span className="annotation-count"><TreePine size={14} style={{ verticalAlign: 'middle', marginRight: '4px' }} />{treeCount} trees</span>
          {pendingCount > 0 && (
            <span className="annotation-pending"><Clock size={12} style={{ verticalAlign: 'middle', marginRight: '3px' }} />{pendingCount} pending height</span>
          )}
          {drawnBoundary && (
            <span className="annotation-pending" style={{ color: '#22d3ee' }}><Ruler size={12} style={{ verticalAlign: 'middle', marginRight: '3px' }} />Boundary set</span>
          )}
        </div>
        <div className="annotation-toolbar__right">
          {firstCorner && (
            <button className="btn btn--secondary btn--sm" onClick={cancelDraw}>
              <X size={12} /> Cancel Box
            </button>
          )}
          {!boundaryMode && (
            <button
              className={`btn btn--sm ${drawMode ? 'btn--active' : 'btn--secondary'}`}
              onClick={() => {
                setDrawMode(!drawMode);
                setSelectedBbox(null);
                if (drawMode) cancelDraw();
              }}
            >
              {drawMode ? <><Pencil size={12} /> Drawing Mode ON</> : <><Plus size={12} /> Add Missing Tree</>}
            </button>
          )}

          {/* Boundary buttons */}
          {!drawMode && !boundaryMode && (
            <button
              className="btn btn--sm btn--secondary"
              onClick={() => {
                setBoundaryMode(true);
                setSelectedBbox(null);
                setDrawMode(false);
                setBoundaryVertices([]);
              }}
              style={{ borderColor: '#22d3ee', color: '#22d3ee' }}
            >
              <Ruler size={12} /> Draw Boundary
            </button>
          )}
          {boundaryMode && (
            <>
              <button className="btn btn--secondary btn--sm" onClick={cancelBoundaryDraw}>
                <X size={12} /> Cancel Boundary
              </button>
              {boundaryVertices.length >= 3 && (
                <button
                  className="btn btn--primary btn--sm"
                  onClick={() => finishBoundary(boundaryVertices)}
                >
                  <Check size={12} /> Close Polygon ({boundaryVertices.length} pts)
                </button>
              )}
            </>
          )}
          {!boundaryMode && drawnBoundary && (
            <>
              <button
                className="btn btn--primary btn--sm"
                onClick={handleSaveBoundary}
                disabled={savingBoundary}
                style={{ background: '#0891b2' }}
              >
                {savingBoundary ? <><Clock size={12} /> Saving...</> : <><Save size={12} /> Save Boundary & Clip Trees</>}
              </button>
              <button
                className="btn btn--secondary btn--sm"
                onClick={clearBoundary}
              >
                <Trash2 size={12} /> Clear Boundary
              </button>
            </>
          )}

          {pendingCount > 0 && !boundaryMode && (
            <button
              className="btn btn--primary btn--sm"
              onClick={handleCalculateHeights}
              disabled={calculating}
            >
              {calculating ? <><Clock size={12} /> Calculating...</> : <><Ruler size={12} /> Calculate Heights ({pendingCount})</>}
            </button>
          )}
        </div>
      </div>

      {/* Instructions */}
      {boundaryMode && (
        <div className="annotation-hint" style={{ borderColor: '#22d3ee', color: '#22d3ee' }}>
          {boundaryVertices.length === 0
            ? 'Click on the map to place the first vertex of the field boundary.'
            : boundaryVertices.length < 3
              ? `${boundaryVertices.length} point(s) placed. Keep clicking to add vertices.`
              : `${boundaryVertices.length} points. Click near the first point to close, or press "Close Polygon".`}
        </div>
      )}

      {!boundaryMode && drawMode && (
        <div className="annotation-hint">
          {firstCorner
            ? 'Click a second point to complete the bounding box.'
            : 'Click the first corner of the tree bounding box on the map.'}
        </div>
      )}

      {!drawMode && !boundaryMode && selectedBbox && (
        <div className="annotation-hint annotation-hint--select">
          Drag the box to move it. Drag a corner handle to resize. Click elsewhere to deselect.
        </div>
      )}

      {calculating && (
        <div className="annotation-hint annotation-hint--saving">
          Computing heights and health for new trees...
        </div>
      )}

      {/* Map */}
      <div
        ref={mapContainer}
        className="annotation-map"
      />
    </div>
  );
}
