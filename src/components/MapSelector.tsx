import { useState, useRef } from 'react';
import { MapContainer, TileLayer } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import html2canvas from 'html2canvas';

interface MapSelectorProps {
    onConfirm: (imageDataUrl: string, widthMeters: number, heightMeters: number) => void;
    planViewportAspectRatio: number;
}

export function MapSelector({ onConfirm, planViewportAspectRatio }: MapSelectorProps) {
    const mapRef = useRef<HTMLDivElement>(null);
    const [isCapturing, setIsCapturing] = useState(false);
    const [isSelectionMode, setIsSelectionMode] = useState(false);
    
    // Viewfinder dimensions (percentage of screen)
    // Initialize with a default aspect ratio or use planViewportAspectRatio once available
    const [viewfinderSize, setViewfinderSize] = useState({ w: 60, h: 60 / planViewportAspectRatio });
    // We need state to hold the map instance to get bounds
    const [mapInstance, setMapInstance] = useState<L.Map | null>(null);

    const handleConfirm = async () => {
        if (!mapRef.current || !mapInstance) return;
        setIsCapturing(true);

        try {
            // 1. Capture the visual map
            // We use the map container ref
            const canvas = await html2canvas(mapRef.current, {
                useCORS: true,
                allowTaint: false,
                logging: false,
                ignoreElements: (element: Element) => element.classList.contains('ui-overlay')
            } as any);

            // 2. Crop to Viewfinder
            const vw = mapRef.current.clientWidth;
            const vh = mapRef.current.clientHeight;
            
            // Calculate scale factor (html2canvas result might be larger due to DPR)
            const scaleX = canvas.width / vw;
            const scaleY = canvas.height / vh;
            
            // Viewfinder size in CSS pixels
            const cssCropW = (vw * viewfinderSize.w) / 100;
            const cssCropH = (vh * viewfinderSize.h) / 100;
            const cssCropX = (vw - cssCropW) / 2;
            const cssCropY = (vh - cssCropH) / 2;
            
            // Scaled crop dimensions
            const cropX = cssCropX * scaleX;
            const cropY = cssCropY * scaleY;
            const cropW = cssCropW * scaleX;
            const cropH = cssCropH * scaleY;

            const croppedCanvas = document.createElement('canvas');
            croppedCanvas.width = cropW;
            croppedCanvas.height = cropH;
            const ctx = croppedCanvas.getContext('2d');
            if (!ctx) throw new Error("No context");

            // User requested flip both Vertical and Horizontal
            ctx.translate(cropW, cropH);
            ctx.scale(-1, -1);

            ctx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

            const dataUrl = croppedCanvas.toDataURL('image/png');

            // 3. Calculate Real World Dimensions
            const bounds = mapInstance.getBounds();
            const northEast = bounds.getNorthEast();
            const southWest = bounds.getSouthWest();
            
            // Total visible meters
            const mapWidthMeters = mapInstance.distance(southWest, new L.LatLng(southWest.lat, northEast.lng));
            const mapHeightMeters = mapInstance.distance(southWest, new L.LatLng(northEast.lat, southWest.lng));

            // Adjust for crop fraction
            const finalWidthMeters = mapWidthMeters * (viewfinderSize.w / 100);
            const finalHeightMeters = mapHeightMeters * (viewfinderSize.h / 100);

            onConfirm(dataUrl, finalWidthMeters, finalHeightMeters);

        } catch (e) {
            console.error("Capture error:", e);
            alert("Could not capture map image. Ensure CORS is enabled for tiles.");
        } finally {
            setIsCapturing(false);
        }
    };

    // Resize logic
    const resizingRef = useRef(false);
    const startResize = (e: React.PointerEvent) => {
        e.preventDefault();
        resizingRef.current = true;
        const startX = e.clientX;
        const startW = viewfinderSize.w;
        
        const handleMove = (ev: PointerEvent) => {
            if (!mapRef.current) return;
            const vw = mapRef.current.clientWidth;
            
            const dx = ev.clientX - startX;
            // Only adjust width based on mouse movement, derive height from aspect ratio
            const dW = (dx / vw) * 100 * 2; 
            
            const newW = Math.max(20, Math.min(90, startW + dW));
            const newH = newW / planViewportAspectRatio; // Maintain aspect ratio
            
            setViewfinderSize({
                w: newW,
                h: newH
            });
        };
        
        const handleUp = () => {
            resizingRef.current = false;
            window.removeEventListener('pointermove', handleMove);
            window.removeEventListener('pointerup', handleUp);
        };
        
        window.addEventListener('pointermove', handleMove);
        window.addEventListener('pointerup', handleUp);
    };

    return (
        <div style={{ position: 'relative', width: '100%', height: '100vh', background: '#333' }}>
            {/* Map Container */}
            <div ref={mapRef} style={{ width: '100%', height: '100%' }}>
                <MapContainer 
                    center={[51.505, -0.09]} 
                    zoom={18} 
                    style={{ width: '100%', height: '100%' }}
                    ref={setMapInstance}
                    zoomControl={false} 
                >
                    <TileLayer
                        attribution='Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
                        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                        maxZoom={19}
                        crossOrigin="anonymous" 
                    />
                    <TileLayer
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                        opacity={1.0} // Increased from 0.4 to 1.0 (User request: "easily visible")
                        crossOrigin="anonymous"
                    />
                </MapContainer>
            </div>

            {/* Viewfinder Overlay (Only in Selection Mode) */}
            {isSelectionMode && (
                <div className="ui-overlay" style={{
                    position: 'absolute',
                    top: 0, left: 0, right: 0, bottom: 0,
                    pointerEvents: 'none', 
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    alignItems: 'center',
                    zIndex: 1000
                }}>
                    <div style={{
                        width: `${viewfinderSize.w}%`,
                        height: `${viewfinderSize.h}%`,
                        border: '4px solid white',
                        boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.5)', 
                        position: 'relative',
                        borderRadius: '8px',
                        pointerEvents: 'auto' // Enable pointer events for resize handle
                    }}>
                        <div style={{
                            position: 'absolute',
                            top: '-30px',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            color: 'white',
                            fontWeight: 'bold',
                            textShadow: '0 2px 4px rgba(0,0,0,0.8)',
                            whiteSpace: 'nowrap'
                        }}>
                            Selection Area
                        </div>
                        
                        {/* Resize Handle (Bottom Right) */}
                        <div 
                            onPointerDown={startResize}
                            style={{
                                position: 'absolute',
                                bottom: '-10px',
                                right: '-10px',
                                width: '20px',
                                height: '20px',
                                background: 'white',
                                borderRadius: '50%',
                                cursor: 'nwse-resize',
                                boxShadow: '0 2px 4px rgba(0,0,0,0.5)'
                            }}
                        />
                    </div>
                </div>
            )}

            {/* Controls */}
            <div className="ui-overlay" style={{
                position: 'absolute',
                top: '20px',
                left: '20px',
                zIndex: 1001,
                background: 'rgba(255,255,255,0.95)',
                padding: '15px',
                borderRadius: '8px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                maxWidth: '300px'
            }}>
                <h3 style={{ margin: '0 0 10px 0', fontSize: '18px' }}>
                    {isSelectionMode ? "Step 2: Select Area" : "Step 1: Locate Property"}
                </h3>
                <p style={{ margin: '0 0 15px 0', fontSize: '14px', color: '#555', lineHeight: '1.4' }}>
                    {isSelectionMode 
                        ? "Drag the corner handle to resize. Pan map to frame the property." 
                        : "Navigate to the location you want to model."}
                </p>
                
                {!isSelectionMode ? (
                    <button 
                        onClick={() => setIsSelectionMode(true)}
                        style={{
                            background: '#007bff',
                            color: 'white',
                            border: 'none',
                            padding: '12px 20px',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontWeight: 'bold',
                            width: '100%',
                            fontSize: '14px'
                        }}
                    >
                        Select Area
                    </button>
                ) : (
                    <div style={{ display: 'flex', gap: '10px' }}>
                         <button 
                            onClick={() => setIsSelectionMode(false)}
                            style={{
                                background: '#6c757d',
                                color: 'white',
                                border: 'none',
                                padding: '10px',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontWeight: 'bold',
                                flex: 1,
                                fontSize: '14px'
                            }}
                        >
                            Cancel
                        </button>
                        <button 
                            onClick={handleConfirm}
                            disabled={isCapturing}
                            style={{
                                background: '#28a745',
                                color: 'white',
                                border: 'none',
                                padding: '10px',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontWeight: 'bold',
                                flex: 1,
                                fontSize: '14px',
                                opacity: isCapturing ? 0.7 : 1
                            }}
                        >
                            {isCapturing ? 'Capturing...' : 'Capture'}
                        </button>
                    </div>
                )}
            </div>
            
            <div className="ui-overlay" style={{
                position: 'absolute',
                bottom: '10px',
                right: '10px',
                zIndex: 1001,
                background: 'rgba(255,255,255,0.7)',
                padding: '2px 5px',
                fontSize: '10px',
                borderRadius: '4px',
                pointerEvents: 'auto'
            }}>
               Map data &copy; Esri, OSM
            </div>
        </div>
    );
}
