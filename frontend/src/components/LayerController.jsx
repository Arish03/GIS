import { ChevronRight, SlidersHorizontal, Leaf } from 'lucide-react';
import ToggleSwitch from './ui/ToggleSwitch';

export default function LayerController({
  layers,
  setLayers,
  viIndices = [],
  viPalettes = [],
  selectedIndex,
  selectedPalette,
  onIndexChange,
  onPaletteChange,
  isCollapsed = false,
  onToggleCollapse,
}) {
  const setBase = (type) => {
    setLayers(prev => ({ ...prev, base: type }));
  };

  const toggleOverlay = (key) => {
    setLayers(prev => ({
      ...prev,
      overlays: { ...prev.overlays, [key]: !prev.overlays[key] },
    }));
  };

  return (
    <>
      {/* Sidebar background and container */}
      <div
        className={`fixed top-16 bottom-0 left-0 z-40 bg-white/75 backdrop-blur-xl border-r border-white/90 shadow-[4px_0_24px_rgba(0,0,0,0.06)] transition-all duration-300 ease-in-out flex flex-col ${isCollapsed ? '-translate-x-full' : 'translate-x-0'}`}
        style={{ width: '280px' }}
      >
        <div className="flex-1 overflow-y-auto w-full p-5 space-y-8 scrollbar-thin">

          <div className="flex items-center gap-2 mb-2">
            <SlidersHorizontal size={18} className="text-slate-800" />
            <h2 className="font-heading font-bold text-slate-800 text-lg tracking-tight">Map Layers</h2>
          </div>

          {/* BASE MAP SECTION */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-1">Base Map</h3>
            <div className="space-y-1">
              {/* Orthomosaic */}
              <label className="flex items-center gap-3 p-2.5 rounded-xl cursor-pointer hover:bg-white/50 transition-colors">
                <input
                  type="radio"
                  name="basemap"
                  className="w-4 h-4 text-primary-600 focus:ring-primary-500 border-slate-300"
                  checked={layers.base === 'ortho'}
                  onChange={() => setBase('ortho')}
                />
                <span className="text-sm font-medium text-slate-700">Orthomosaic (Aerial)</span>
              </label>

              {/* DTM */}
              <label className="flex items-center gap-3 p-2.5 rounded-xl cursor-pointer hover:bg-white/50 transition-colors">
                <input
                  type="radio"
                  name="basemap"
                  className="w-4 h-4 text-primary-600 focus:ring-primary-500 border-slate-300"
                  checked={layers.base === 'dtm'}
                  onChange={() => setBase('dtm')}
                />
                <span className="text-sm font-medium text-slate-700">DTM (Ground)</span>
              </label>

              {/* DSM */}
              <label className="flex items-center gap-3 p-2.5 rounded-xl cursor-pointer hover:bg-white/50 transition-colors">
                <input
                  type="radio"
                  name="basemap"
                  className="w-4 h-4 text-primary-600 focus:ring-primary-500 border-slate-300"
                  checked={layers.base === 'dsm'}
                  onChange={() => setBase('dsm')}
                />
                <span className="text-sm font-medium text-slate-700">DSM (Surface)</span>
              </label>

              {/* Plant Health */}
              <label className={`flex items-center gap-3 p-2.5 rounded-xl cursor-pointer hover:bg-white/50 transition-colors ${viIndices.length === 0 ? 'opacity-50' : ''}`}>
                <input
                  type="radio"
                  name="basemap"
                  className="w-4 h-4 text-primary-600 focus:ring-primary-500 border-slate-300"
                  checked={layers.base === 'plant-health'}
                  onChange={() => setBase('plant-health')}
                  disabled={viIndices.length === 0}
                />
                <span className="text-sm font-medium text-slate-700 flex items-center gap-1">
                  <Leaf size={14} className="text-primary-500" /> Plant Health
                </span>
              </label>

              {/* VI sub-controls — only when plant-health selected & indices available */}
              {layers.base === 'plant-health' && viIndices.length > 0 && (
                <div className="ml-8 p-3 rounded-xl bg-white/40 border border-white/60 space-y-3 animate-fade-in">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Formula</label>
                    <select
                      value={selectedIndex}
                      onChange={e => onIndexChange(e.target.value)}
                      className="w-full bg-white/80 border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-slate-700 focus:outline-none focus:border-primary-500"
                    >
                      {viIndices.map(idx => (
                        <option key={idx.name} value={idx.name} title={idx.desc}>
                          {idx.name} — {idx.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Color Palette</label>
                    <select
                      value={selectedPalette}
                      onChange={e => onPaletteChange(e.target.value)}
                      className="w-full bg-white/80 border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-slate-700 focus:outline-none focus:border-primary-500"
                    >
                      {viPalettes.map(p => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="h-px w-full bg-slate-200/60" />

          {/* OVERLAYS SECTION */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-1">Overlays</h3>
            <div className="space-y-2 pl-1">
              <ToggleSwitch
                label="Plantation Boundary"
                checked={layers.overlays.boundary}
                onChange={() => toggleOverlay('boundary')}
              />
              <ToggleSwitch
                label="Tree Locations"
                checked={layers.overlays.trees}
                onChange={() => toggleOverlay('trees')}
              />
              <ToggleSwitch
                label="Health Analysis"
                checked={layers.overlays.health}
                onChange={() => toggleOverlay('health')}
              />
              <ToggleSwitch
                label="Height Heatmap"
                checked={layers.overlays.height}
                onChange={() => toggleOverlay('height')}
              />
            </div>
          </div>

        </div>
      </div>

      {/* Collapse Toggle Button */}
      <button
        onClick={onToggleCollapse}
        className={`fixed top-1/2 -translate-y-1/2 z-40 w-8 h-14 bg-white/80 backdrop-blur-md border border-white/90 shadow-glass flex items-center justify-center text-slate-500 hover:text-slate-800 hover:bg-white transition-all duration-300 rounded-r-xl border-l-0 cursor-pointer ${isCollapsed ? 'left-0' : 'left-[280px]'}`}
        title={isCollapsed ? 'Show Layers' : 'Hide Layers'}
      >
        <ChevronRight size={20} className={`transition-transform duration-300 ${!isCollapsed ? 'rotate-180' : ''}`} />
      </button>
    </>
  );
}
