import React from 'react';

interface ElevationSelectorProps {
    width: number;
    depth: number;
    height: number;
    slope: number;
    roofType: 'flat' | 'gable';
    activeDirection: 'N' | 'S' | 'E' | 'W';
    onSelect: (dir: 'N' | 'S' | 'E' | 'W') => void;
}

export const ElevationSelector: React.FC<ElevationSelectorProps> = ({
    width,
    depth,
    height,
    slope,
    roofType,
    activeDirection,
    onSelect
}) => {
    
    // Helper to generate SVG path
    const renderThumbnail = (viewDir: 'N' | 'S' | 'E' | 'W') => {
        // Determine visible width based on view direction
        // West/East look along X axis -> See Z dimension (Depth)
        // North/South look along Z axis -> See X dimension (Width)
        const isLongitudinal = viewDir === 'N' || viewDir === 'S';
        const viewWidth = isLongitudinal ? width : depth;
        
        // Determine Profile Type
        // Gable Roof is oriented along X-axis (East/West).
        // So West/East views see the Gable Face (Triangle).
        // North/South views see the Side Face (Rectangle).
        const isGableFace = !isLongitudinal; 
        
        const BOX_SIZE = 180;
        const PADDING = 20; // Padding from edges
        const availableSize = BOX_SIZE - (PADDING * 2);
        
        // Calculate dynamic scale to fit the largest dimension
        // We consider the bounding box of the specific view or the global max?
        // Ideally global max so all thumbnails share scale, OR view specific?
        // User asked to "scale down... when user make the house really wide".
        // Let's use view-specific max dimension to maximize usage, 
        // OR global to keep proportions consistent. 
        // Consistent proportions are better for "Select View" context.
        // The building's bounding box is (width, depth, height + slope).
        
        const totalH = height + (roofType === 'flat' ? 0.5 : slope);
        const maxDim = Math.max(width, depth, totalH);
        
        // Default scale 5.4 was good for ~30m.
        // 180 / 30 = 6. So 5.4 is safe.
        // If maxDim > 30, we need to scale down.
        // fitScale = availableSize / maxDim
        const fitScale = availableSize / maxDim;
        
        // Cap the scale at 7.5 so small houses don't look huge, 
        // but allow it to shrink indefinitely for large houses.
        const SCALE = Math.min(7.5, fitScale);

        const centerX = BOX_SIZE / 2;
        const bottomY = BOX_SIZE - PADDING; // Padding from bottom

        // Calculate scaled dimensions
        const wPx = viewWidth * SCALE;
        const hPx = height * SCALE;
        const sPx = slope * SCALE;
        const roofH_Flat = 0.5 * SCALE;

        // Base Rectangle Points (Centered)
        const baseX = centerX - wPx / 2;
        const baseY = bottomY - hPx;
        
        // Base Path
        const basePath = `M ${baseX},${bottomY} L ${baseX + wPx},${bottomY} L ${baseX + wPx},${baseY} L ${baseX},${baseY} Z`;

        // Roof Path
        let roofPath = '';
        
        if (roofType === 'flat') {
            // Flat roof is always a rectangle on top
            const roofY = baseY - roofH_Flat;
            // Overhang usually exists, let's add slightly
            const overhang = 0.5 * SCALE;
            roofPath = `M ${baseX - overhang},${baseY} L ${baseX + wPx + overhang},${baseY} L ${baseX + wPx + overhang},${roofY} L ${baseX - overhang},${roofY} Z`;
        } else {
            // Gable Roof
            if (isGableFace) {
                // Triangle
                const apexX = centerX;
                const apexY = baseY - sPx;
                roofPath = `M ${baseX},${baseY} L ${baseX + wPx},${baseY} L ${apexX},${apexY} Z`;
            } else {
                // Side View of Gable (Rectangle + Slanted top?) 
                // Actually it's just a rectangle for the roof part too from the side, 
                // but the ridge is visible.
                // It looks like a rectangle of height 'slope' sitting on top.
                const roofTopY = baseY - sPx;
                roofPath = `M ${baseX},${baseY} L ${baseX + wPx},${baseY} L ${baseX + wPx},${roofTopY} L ${baseX},${roofTopY} Z`;
            }
        }

        return (
            <svg width="100%" height="100%" viewBox={`0 0 ${BOX_SIZE} ${BOX_SIZE}`} style={{ overflow: 'visible', maxHeight: '100%' }}>
                <path d={basePath} fill="#e0e0e0" stroke="#666" strokeWidth="2" />
                <path d={roofPath} fill={roofType === 'gable' ? '#ffcccb' : '#ccc'} stroke="#666" strokeWidth="2" />
            </svg>
        );
    };

    const directions: ('W' | 'N' | 'E' | 'S')[] = ['W', 'N', 'E', 'S'];

    return (
        <div style={{ 
            display: 'flex', 
            width: '100%', 
            height: '100%', 
            background: '#f5f5f5', 
            borderTop: '1px solid #ddd'
        }}>
            {directions.map(dir => (
                <div 
                    key={dir}
                    onClick={() => onSelect(dir)}
                    style={{
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        background: activeDirection === dir ? '#e6f0ff' : 'transparent',
                        borderRight: dir !== 'S' ? '1px solid #ddd' : 'none',
                        transition: 'background 0.2s',
                        paddingTop: '10px' // Added padding to the top
                    }}
                >
                    <div style={{ marginBottom: '10px', fontWeight: 'bold', fontSize: '14px', color: '#555' }}>
                        {dir === 'N' ? 'North' : dir === 'S' ? 'South' : dir === 'E' ? 'East' : 'West'}
                    </div>
                    {renderThumbnail(dir)}
                </div>
            ))}
        </div>
    );
};
