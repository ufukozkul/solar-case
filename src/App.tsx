import { useState, useRef, useEffect } from 'react';
import { CanvasContainer } from './components/CanvasContainer';
import { SceneController } from './babylon/SceneController';
import { ElevationSelector } from './components/ElevationSelector';
import { MapSelector } from './components/MapSelector';

export default function App() {
  const [view, setView] = useState<'map' | 'editor'>('map');
  const [mapData, setMapData] = useState<{ url: string, width: number, height: number } | null>(null);

  const [controller, setController] = useState<SceneController | null>(null);
  const [activeTool, setActiveTool] = useState<'select' | 'add_flat' | 'add_gable'>('select');
  const [hasSelection, setHasSelection] = useState(false);
  const [width, setWidth] = useState(10);
  const [depth, setDepth] = useState(6);
  const [slope, setSlope] = useState(2);
  const [eavesHeight, setEavesHeight] = useState(4);
  const [ridgeHeight, setRidgeHeight] = useState(6);
  const [roofType, setRoofType] = useState<'flat' | 'gable'>('gable');
  const [elevationDir, setElevationDir] = useState<'N' | 'S' | 'E' | 'W'>('S');
  const [, setActiveViewport] = useState<'none' | 'plan' | 'iso' | 'elevation'>('none');
  const [planViewportAspectRatio, setPlanViewportAspectRatio] = useState(1); // Default to 1
  
  const [draggingHandle, setDraggingHandle] = useState<'eaves' | 'ridge' | null>(null);
  const [dragMode, setDragMode] = useState<'debug' | 'projected'>('projected');
  const dragStartRef = useRef<{ y: number, initialHeight: number }>({ y: 0, initialHeight: 0 });
  
  const [guidePositions, setGuidePositions] = useState<{
      eaves: { x: number, y: number } | null;
      ridge: { x: number, y: number } | null;
      pixelsPerMeter: number;
  }>({ eaves: null, ridge: null, pixelsPerMeter: 1 });

  const handleMapConfirm = (url: string, width: number, height: number) => {
      setMapData({ url, width, height });
      setView('editor');
  };

  // Update callbacks when roofType changes to avoid stale closure
  useEffect(() => {
      if (!controller) return;
      
      controller.onDimensionsChange = (w, d, h, s) => {
          setWidth(w);
          setDepth(d);
          setEavesHeight(h);
          setSlope(s); // Update slope state
          if (roofType === 'flat') {
              setRidgeHeight(30);
          } else {
              setRidgeHeight(h + s);
          }
      };
  }, [controller, roofType]);

  const handleControllerReady = (ctrl: SceneController) => {
    setController(ctrl);
    
    // Apply background if we have it
    if (mapData) {
        ctrl.setBackgroundImage(mapData.url, mapData.width, mapData.height);
    }

    ctrl.onSelectionChange = (mesh) => {
      setHasSelection(!!mesh);
      if (mesh) {
          const w = mesh.metadata.width;
          const d = mesh.metadata.depth;
          const h = mesh.metadata.height;
          const s = mesh.metadata.slope || 0;
          const rType = mesh.metadata.roofType; // Enum 'Flat' or 'Gable'
          
          setWidth(w);
          setDepth(d);
          setEavesHeight(h);
          setSlope(s);
          
          // Normalize to lowercase for local state
          const normalizedType = (rType && rType.toLowerCase() === 'flat') ? 'flat' : 'gable';
          setRoofType(normalizedType);
          
          if (normalizedType === 'flat') {
              setRidgeHeight(30); 
          } else {
              setRidgeHeight(h + s);
          }
      }
    };
    ctrl.onSlopeChange = (newSlope) => {
      setSlope(newSlope);
    };
    // onDimensionsChange is set in useEffect
    ctrl.onGuidesPositionChange = (data) => {
        setGuidePositions(data);
    };
    ctrl.onActiveViewportChange = (viewport) => {
        setActiveViewport(viewport);
    };
    ctrl.onToolChange = (tool) => {
      setActiveTool(tool);
    };
    ctrl.onPlanViewportAspectRatioChange = (ratio) => {
        setPlanViewportAspectRatio(ratio);
    };
  };

  const handleCanvasDown = (e: React.PointerEvent) => {
      if (!controller) return;
      // Check if we hit a guide line
      const type = controller.pickGuide(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
      if (type) {
          startDrag(type, e, 'projected');
      }
  };

  useEffect(() => {
      const handleMove = (e: PointerEvent) => {
          if (!draggingHandle || !controller) return;
          
          let pixelsPerMeter = guidePositions.pixelsPerMeter || 1;
          if (dragMode === 'debug') {
              pixelsPerMeter = 200 / 30; // 200px track for 30m height
          }
          
          const deltaPixels = dragStartRef.current.y - e.clientY; 
          const deltaMeters = deltaPixels / pixelsPerMeter;
          
          console.log('Drag Debug:', {
              dragMode,
              pixelsPerMeter,
              deltaPixels,
              deltaMeters,
              startY: dragStartRef.current.y,
              currY: e.clientY
          });

          let newHeight = dragStartRef.current.initialHeight + deltaMeters;
          
          // Clamp values with constraints
          if (draggingHandle === 'eaves') {
              // Eaves max is Ridge - 0.5 (unless flat)
              let maxEaves = Math.max(1, ridgeHeight - 0.5);
              if (roofType === 'flat') {
                  maxEaves = 30;
              }
              
              newHeight = Math.max(1, Math.min(maxEaves, newHeight));
              
              controller.setEavesHeight(newHeight);
              // setEavesHeight(newHeight); // Removed to rely on controller callback
          } else {
              // Ridge min is Eaves + 0.5
              const minRidge = Math.min(30, eavesHeight + 0.5);
              newHeight = Math.max(minRidge, Math.min(30, newHeight));
              
              controller.setRidgeHeight(newHeight);
              // setRidgeHeight(newHeight); // Removed to rely on controller callback
          }
      };
      
      const handleUp = () => {
          setDraggingHandle(null);
          if (controller) {
              controller.isAppDragging = false;
              // Force re-evaluation of viewport/input state
              controller.refreshInput();
          }
      };
      
      if (draggingHandle) {
          window.addEventListener('pointermove', handleMove);
          window.addEventListener('pointerup', handleUp);
      }
      
      return () => {
          window.removeEventListener('pointermove', handleMove);
          window.removeEventListener('pointerup', handleUp);
      }
  }, [draggingHandle, controller, ridgeHeight, eavesHeight, guidePositions.pixelsPerMeter, roofType]); // Added roofType dependency

  const startDrag = (type: 'eaves' | 'ridge', e: React.PointerEvent | PointerEvent, mode: 'debug' | 'projected') => {
      e.preventDefault();
      e.stopPropagation(); // Prevent camera interaction
      
      setDraggingHandle(type);
      setDragMode(mode);
      const startY = e.clientY;
      const initial = type === 'eaves' ? eavesHeight : ridgeHeight;
      dragStartRef.current = { y: startY, initialHeight: initial };
      
      if (controller) controller.isAppDragging = true;
  };

  const handleToolChange = (tool: 'select' | 'add_flat' | 'add_gable') => {
    setActiveTool(tool);
    controller?.setTool(tool);
  };
  
  const handleSlopeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = parseFloat(e.target.value);
      setSlope(val);
      controller?.setSlope(val);
  }

  const handleElevationChange = (dir: 'N' | 'S' | 'E' | 'W') => {
      setElevationDir(dir);
      controller?.setElevationView(dir);
  }

  if (view === 'map') {
      return <MapSelector onConfirm={handleMapConfirm} planViewportAspectRatio={planViewportAspectRatio} />;
  }

  return (
    <div className="app-container">
      <div className="toolbar">
        <div style={{ fontWeight: 'bold', marginRight: '20px' }}>Solar Case</div>
        <button 
            className={`btn ${activeTool === 'select' ? 'active' : ''}`}
            onClick={() => handleToolChange('select')}>
            Select / Edit
        </button>
        <button 
            className={`btn ${activeTool === 'add_flat' ? 'active' : ''}`}
            onClick={() => handleToolChange('add_flat')}>
            Flat Roof
        </button>
        <button 
            className={`btn ${activeTool === 'add_gable' ? 'active' : ''}`}
            onClick={() => handleToolChange('add_gable')}>
            Gable Roof
        </button>
        
        {hasSelection && (
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <label>Slope:</label>
                <input 
                    type="range" min="0.5" max="30" step="0.1" 
                    value={slope} 
                    onChange={handleSlopeChange} 
                />
                <span>{slope.toFixed(1)}m</span>
            </div>
        )}
      </div>
      <div className="canvas-container">
        <div style={{ width: '100%', height: '100%' }} onPointerDown={handleCanvasDown}>
            <CanvasContainer onControllerReady={handleControllerReady} />
        </div>
        <div className="overlay-ui" style={{ width: '100%', height: '100%' }}>
            {/* Plan View Label (Left 65%) */}
            <div style={{ position: 'absolute', left: '10px', top: '10px', background: 'rgba(255,255,255,0.7)', padding: '4px 8px', borderRadius: '4px', pointerEvents: 'none' }}>
                Plan View (2D)
            </div>
            
            {/* 3D View Label (Right Top) */}
            <div style={{ position: 'absolute', left: '66%', top: '10px', background: 'rgba(255,255,255,0.7)', padding: '4px 8px', borderRadius: '4px', pointerEvents: 'none' }}>
                3D View
            </div>

            {/* Elevation View Label (Top of Quadrant) */}
            <div style={{ position: 'absolute', left: '66%', top: '50.5%', pointerEvents: 'none', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ background: 'rgba(255,255,255,0.7)', padding: '4px 8px', borderRadius: '4px' }}>
                    Elevation View
                </div>
                {/* Fixed Height Display */}
                {hasSelection && (
                    <div style={{ 
                        display: 'flex',
                        gap: '10px',
                        fontSize: '12px',
                        fontWeight: '500',
                        color: '#333'
                    }}>
                        <div style={{ background: 'rgba(255,255,255,0.6)', padding: '4px 6px', borderRadius: '4px' }}>
                            Eaves: {eavesHeight.toFixed(2)}m
                        </div>
                        {roofType !== 'flat' && (
                            <div style={{ background: 'rgba(255,255,255,0.6)', padding: '4px 6px', borderRadius: '4px' }}>
                                Ridge: {ridgeHeight.toFixed(2)}m
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* View Selector (Bottom of Quadrant) */}
            {hasSelection && (
                <div style={{ 
                    position: 'absolute', 
                    left: '65%', 
                    right: '0', 
                    bottom: '30px', 
                    height: '160px', // Adjust height as needed
                    pointerEvents: 'auto' 
                }}>
                    <ElevationSelector
                        width={width}
                        depth={depth}
                        height={eavesHeight}
                        slope={slope}
                        roofType={roofType}
                        activeDirection={elevationDir}
                        onSelect={handleElevationChange}
                    />
                </div>
            )}
           
            {/* Vertical Divider (65%) */}
            <div style={{ position: 'absolute', left: '65%', top: '0', bottom: '0', width: '2px', background: 'rgba(0,0,0,0.1)', pointerEvents: 'none' }}></div>
            
            {/* Horizontal Divider (Right Side 50%) */}
            <div style={{ position: 'absolute', left: '65%', right: '0', top: '50%', height: '2px', background: 'rgba(0,0,0,0.1)', pointerEvents: 'none' }}></div>
        </div>
      </div>
    </div>
  );
}
