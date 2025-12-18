# Solar Case Project

## Project Overview

This project is a web-based **Rooftop Modeling Interface** developed using **React**, **TypeScript**, and **BabylonJS**. It is designed to simulate a simplified solar design tool where users can:
1.  **Locate a Property:** Browse a global satellite map and select a specific area.
2.  **Model Structure:** Place and modify building structures on the captured satellite image in 2D and visualize them simultaneously in 3D.

**Key Features:**

### 1. Map Selector (Landing Page)
*   **Interactive Map:** Users start by navigating a global satellite map (Esri World Imagery + OpenStreetMap labels).
*   **Area Selection:** A "Select Area" tool provides a resizable viewfinder (preserving the 2D viewport aspect ratio) to capture a specific property.
*   **Image Capture:** Captures high-resolution satellite imagery of the selected area to serve as the ground plane for modeling.

### 2. Modeling Interface (Split-Screen)
*   **Left (Plan View - 65% width):** 
    *   **2D Top-down Orthographic view** for precise placement and editing.
    *   **Satellite Background:** The captured map image is displayed here.
    *   **Visibility:** Buildings are rendered with 25% opacity to allow seeing the satellite image underneath for alignment.
*   **Right Top (35% width, 50% height):** 
    *   **3D Perspective view** for visualization.
    *   **Clean Look:** Displays buildings on a technical grid floor (Satellite image is hidden).
*   **Right Bottom (35% width, 50% height):** 
    *   **Elevation View** (Orthographic) for side-profile viewing and height adjustments. Only the selected house is visible here.

### 3. Building Tools
*   **Flat Roof:** Creates box-shaped building models.
*   **Gable Roof:** Creates buildings with a triangular prism roof (dual pitch).
*   **Preview:** A "ghost" mesh appears under the cursor showing the exact geometry before placement.

### 4. Interactive Editing
*   **Selection:** Click to select buildings. Selected buildings display interactive handles.
*   **Relocation:** In the 2D Plan View, clicking and dragging the building body moves the entire structure.
*   **Asymmetric Resizing (Plan View Only):**
    *   **Corner Handles (Yellow Spheres):** Adjust width and depth asymmetrically.
    *   **Edge Handles (Yellow Rectangles):** Adjust *only* Width or Depth.
    *   **Interaction Priority:** Handles are geometrically positioned above the roof (`Height + Slope + 1`) to ensure they are picked first by the mouse ray, avoiding conflict with the building body. They are masked to appear only in the Plan View.
*   **Rotation:** A Blue Cylindrical Handle rotates the building around its center.
*   **Height Adjustment (Elevation View Only):** 
    *   **Interactive Guides:** Dotted lines represent Eaves and Ridge levels.
    *   **Hover Behavior:** Dotted lines turn into solid, draggable lines when hovered, allowing intuitive height adjustment without visual clutter.

## Tech Stack

*   **Framework:** [React](https://react.dev/)
*   **Build Tool:** [Vite](https://vitejs.dev/)
*   **Language:** [TypeScript](https://www.typescriptlang.org/)
*   **3D Engine:** [BabylonJS](https://www.babylonjs.com/) (Core & Materials)
*   **Mapping:** [Leaflet](https://leafletjs.com/) & [React-Leaflet](https://react-leaflet.js.org/)
*   **Image Capture:** [html2canvas](https://html2canvas.hertzen.com/)
*   **Styling:** CSS & Inline Styles.

## Directory Structure

*   `src/`
    *   `babylon/`: Contains the core 3D logic.
        *   `SceneController.ts`: The bridge between React and BabylonJS. Manages the engine, scenes, cameras, layer masks, and input logic.
        *   `types.ts`: TypeScript interfaces for building configurations and enums.
    *   `components/`: React components.
        *   `CanvasContainer.tsx`: Initializes the 3D scene.
        *   `MapSelector.tsx`: Handles the initial map navigation and image capture.
        *   `ElevationSelector.tsx`: UI for switching elevation camera angles.
    *   `App.tsx`: Main application state manager, switching between Map and Editor views.
    *   `main.tsx`: Entry point.

## Building and Running

### Prerequisites
*   Node.js (v18+ recommended)
*   npm

### Commands

1.  **Install Dependencies:**
    ```bash
    npm install
    ```

2.  **Start Development Server:**
    ```bash
    npm run dev
    ```
    This will start the local server (usually at `http://localhost:5173`).

3.  **Build for Production:**
    ```bash
    npm run build
    ```

4.  **Preview Build:**
    ```bash
    npm run preview
    ```

## Development Conventions

*   **Layer Masks:** The project uses BabylonJS `layerMask` to isolate objects between viewports:
    *   `MASK_PLAN (0x1)`: Satellite Image, Plan View Handles.
    *   `MASK_ISO (0x2)`: Ground Grid.
    *   `MASK_ELEVATION (0x4)`: Elevation Guides.
    *   *Buildings* share masks to appear in relevant views.
*   **Logic Separation:** `SceneController` handles all 3D logic. React components trigger methods on the controller (e.g., `setEavesHeight`, `setBackgroundImage`).
*   **Mesh Metadata:** `mesh.metadata` is the source of truth for building dimensions and state.
*   **Rebuilding:** Meshes are disposed and rebuilt upon resizing to maintain correct UVs and geometry proportions.
