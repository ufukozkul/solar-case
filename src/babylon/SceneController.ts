import {
  Engine,
  Scene,
  Vector3,
  Color3,
  MeshBuilder,
  StandardMaterial,
  ArcRotateCamera,
  HemisphericLight,
  DirectionalLight,
  Viewport,
  Mesh,
  PointerEventTypes,
  Matrix,
  Nullable,
  AbstractMesh,
  TargetCamera,
  Plane,
  Camera,
  Texture,
} from "@babylonjs/core";
import { GridMaterial } from "@babylonjs/materials/grid";
import { RoofType } from "./types";

const MASK_PLAN = 0x1;
const MASK_ISO = 0x2;
const MASK_ELEVATION = 0x4;

export class SceneController {
  private engine: Engine;
  private scene: Scene;
  private planCamera!: TargetCamera;
  private isoCamera!: ArcRotateCamera;
  private elevationCamera!: ArcRotateCamera;
  
  private buildings: Mesh[] = [];
  private activeTool: "select" | "add_flat" | "add_gable" = "select";
  private selectedMesh: Nullable<Mesh> = null;
  private previewMesh: Nullable<Mesh> = null;
  
  private backgroundPlane: Nullable<Mesh> = null;

  // Dragging state
  private isDragging = false;
  private dragTarget: Nullable<AbstractMesh> = null;
  private draggingBuilding: Nullable<Mesh> = null;
  private draggingHandleType: "corner" | "roof" | "edge_width" | "edge_depth" | "rotate" | "height_eaves" | "height_ridge" | null = null;
  private dragOrigin: Nullable<Vector3> = null;
  
  // Handles
  private handles: Mesh[] = [];
  private hoveredHandle: Nullable<AbstractMesh> = null;
  
  private currentElevationDir: 'N' | 'S' | 'E' | 'W' = 'S';
  private elevationZoom: number = 1.0;
  
  private activeViewport: 'none' | 'plan' | 'iso' | 'elevation' = 'none';
  public isAppDragging = false;

  // Callbacks
  public onSelectionChange?: (mesh: Nullable<Mesh>) => void;
  public onSlopeChange?: (slope: number) => void;
  public onDimensionsChange?: (width: number, depth: number, height: number, slope: number) => void;
  public onToolChange?: (tool: "select" | "add_flat" | "add_gable") => void;
  public onGuidesPositionChange?: (data: { 
      eaves: { x: number, y: number } | null;
      ridge: { x: number, y: number } | null;
      pixelsPerMeter: number;
  }) => void;
  public onActiveViewportChange?: (viewport: 'none' | 'plan' | 'iso' | 'elevation') => void;
  public onGuidePick?: (type: 'eaves' | 'ridge', pointerY: number) => void;
  public onPlanViewportAspectRatioChange?: (ratio: number) => void;

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true);
    this.scene = this.createScene();
    
    this.engine.runRenderLoop(() => {
      this.scene.render();
    });
    
    this.scene.onAfterRenderObservable.add(() => {
        this.updateGuidePositions();
    });

    window.addEventListener("resize", () => {
      this.engine.resize();
      this.updatePlanViewportAspectRatio();
    });
  }

  private updatePlanViewportAspectRatio() {
      const renderWidth = this.engine.getRenderWidth();
      const renderHeight = this.engine.getRenderHeight();
      const planViewportWidth = renderWidth * this.planCamera.viewport.width;
      const planViewportHeight = renderHeight * this.planCamera.viewport.height;
      
      const ratio = planViewportWidth / planViewportHeight;
      if (this.onPlanViewportAspectRatioChange) {
          this.onPlanViewportAspectRatioChange(ratio);
      }
  }

  private createScene(): Scene {
    const scene = new Scene(this.engine);
    scene.clearColor = new Color3(0.9, 0.9, 0.9).toColor4();

    // --- Cameras ---
    
    // 1. Plan View (Left, Top-Down Orthographic)
    this.planCamera = new TargetCamera("planCamera", new Vector3(0, 100, 0), scene);
    this.planCamera.setTarget(Vector3.Zero());
    this.planCamera.mode = TargetCamera.ORTHOGRAPHIC_CAMERA;
    const orthoSize = 30;
    const ratio = this.engine.getRenderWidth() / this.engine.getRenderHeight();
    this.planCamera.orthoTop = orthoSize;
    this.planCamera.orthoBottom = -orthoSize;
    this.planCamera.orthoLeft = -orthoSize * 0.65 * ratio; // Adjusted ratio for 65% width
    this.planCamera.orthoRight = orthoSize * 0.65 * ratio;
    
    this.planCamera.viewport = new Viewport(0, 0, 0.65, 1.0);
    
    this.updatePlanViewportAspectRatio();

    // 2. 3D View (Right Top, Perspective)
    this.isoCamera = new ArcRotateCamera(
      "isoCamera",
      -Math.PI / 4,
      Math.PI / 3,
      50,
      Vector3.Zero(),
      scene
    );
    this.isoCamera.attachControl(this.engine.getRenderingCanvas(), true);
    this.isoCamera.viewport = new Viewport(0.65, 0.5, 0.35, 0.5);

    // 3. Elevation View (Right Bottom, Orthographic)
    this.elevationCamera = new ArcRotateCamera(
        "elevationCamera", 
        -Math.PI / 2, // South
        Math.PI / 2,  // Horizon
        100, 
        Vector3.Zero(), 
        scene
    );
    this.elevationCamera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    this.elevationCamera.orthoTop = orthoSize;
    this.elevationCamera.orthoBottom = -orthoSize;
    this.elevationCamera.orthoLeft = -orthoSize * 0.35 * ratio;
    this.elevationCamera.orthoRight = orthoSize * 0.35 * ratio;
    
    // Lock vertical rotation (beta) to horizontal
    this.elevationCamera.lowerBetaLimit = Math.PI / 2;
    this.elevationCamera.upperBetaLimit = Math.PI / 2;

    this.elevationCamera.viewport = new Viewport(0.65, 0, 0.35, 0.5);
    
    // Layer Masks
    this.planCamera.layerMask = MASK_PLAN;
    this.isoCamera.layerMask = MASK_ISO;
    this.elevationCamera.layerMask = MASK_ELEVATION;

    scene.activeCameras = [this.planCamera, this.isoCamera, this.elevationCamera];

    // --- View-Dependent Rendering Logic ---
    scene.onBeforeCameraRenderObservable.add((camera) => {
        const isPlan = camera === this.planCamera;
        const isElevation = camera === this.elevationCamera;
        
        // 1. Building Transparency
        this.buildings.forEach(b => {
             // If we have children (roof/base), set their visibility
             b.getChildren().forEach((c) => {
                 if (c instanceof AbstractMesh) {
                     // Don't change visibility for handles
                     if (c.metadata?.type === 'handle') {
                         c.visibility = 1.0;
                     } else {
                         // Elevation View: Opaque buildings (Side view)
                         // Plan View: Transparent (0.5)
                         // Iso View: Opaque
                         c.visibility = isPlan ? 0.25 : 1.0;
                     }
                 }
             });
             b.visibility = isPlan ? 0.25 : 1.0;
        });

        // 2. Handle Logic
        this.handles.forEach(h => {
            const type = h.metadata.handleType;
            const isGuide = type === 'guide';

            if (isElevation) {
                // In Elevation View, ONLY show guides
                if (isGuide) {
                    // Respect the active state (dashed vs solid)
                    // Note: Colliders (invisible) will have isActive=undefined usually, 
                    // but we don't want to make them visible.
                    // If h.visibility is 0, isVisible=true won't show it, which is fine.
                    // But for lines, we need isVisible to toggle.
                    
                    if (h.metadata.visualDashed || h.metadata.visualSolid) {
                        // This is a collider. Keep it invisible but pickable.
                        // Wait, colliders should not be toggled here.
                        // Colliders have visibility=0.
                    } else {
                        // Actual line meshes
                        h.isVisible = !!h.metadata.isActive;
                    }
                } else {
                    h.isVisible = false;
                }
                h.renderingGroupId = 1; 
            } else {
                // In Plan/3D View, show everything EXCEPT guides
                h.isVisible = !isGuide;
                h.renderingGroupId = isPlan ? 1 : 0;
            }
        });

        // 3. Clear Depth Buffer
        // Enable depth clearing (3rd param = true) so Group 1 draws ON TOP of Group 0
        scene.setRenderingAutoClearDepthStencil(1, true, true, false);
    });

    // Reset visibility after render
    scene.onAfterRenderObservable.add(() => {
        this.buildings.forEach(b => {
             b.visibility = 1.0;
             b.getChildren().forEach(c => {
                 if (c instanceof AbstractMesh) c.visibility = 1.0;
             });
        });
    });

    // --- Lights ---
    const hemiLight = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
    hemiLight.intensity = 0.7;
    
    const dirLight = new DirectionalLight("dir", new Vector3(-1, -2, -1), scene);
    dirLight.position = new Vector3(20, 40, 20);
    dirLight.intensity = 0.5;

    // --- Ground ---
    const ground = MeshBuilder.CreateGround("ground", { width: 100, height: 100 }, scene);
    
    const groundMat = new GridMaterial("groundMat", scene);
    groundMat.majorUnitFrequency = 10;
    groundMat.minorUnitVisibility = 0.45;
    groundMat.gridRatio = 1;
    groundMat.backFaceCulling = false;
    groundMat.mainColor = new Color3(0.9, 0.9, 0.9);
    groundMat.lineColor = new Color3(0.5, 0.5, 0.5);
    groundMat.opacity = 0.8;
    
    ground.material = groundMat;
    
    ground.isPickable = true;
    ground.metadata = { isGround: true };
    // Ground only visible in ISO view
    ground.layerMask = MASK_ISO;

    // --- Input Handling ---
    scene.onPointerObservable.add((pointerInfo) => {
      this.handlePointer(pointerInfo);
    });

    return scene;
  }
  
  public setBackgroundImage(url: string, width: number, height: number) {
      if (this.backgroundPlane) {
          this.backgroundPlane.dispose();
      }

      this.backgroundPlane = MeshBuilder.CreatePlane("background_plane", { width, height }, this.scene);
      this.backgroundPlane.rotation.x = Math.PI / 2; // Flat on ground
      this.backgroundPlane.position.y = -0.1; // Below buildings (and technically below grid if grid was there)
      
      const mat = new StandardMaterial("background_mat", this.scene);
      mat.diffuseTexture = new Texture(url, this.scene);
      mat.diffuseTexture.hasAlpha = false;
      mat.backFaceCulling = false;
      mat.disableLighting = true; // Unlit
      mat.emissiveColor = Color3.White(); // Full brightness
      
      this.backgroundPlane.material = mat;
      this.backgroundPlane.isPickable = false;
      
      // ONLY VISIBLE IN PLAN VIEW
      this.backgroundPlane.layerMask = MASK_PLAN;

            // Auto-fit Plan Camera to Image

            // Max dimension determines the ortho scale needed

            

            // Add 10% padding
      
      // We set orthoTop/Bottom. Left/Right are calculated by aspect ratio.
      // But we need to ensure the whole image fits.
      // If image is wide, we need to ensure width fits.
      
      const ratio = this.engine.getRenderWidth() / this.engine.getRenderHeight();
      // The Plan View port is 0.65 width.
      const viewportRatio = ratio * 0.65; 

      // If image aspect (width/height) > viewportRatio, we are Width constrained.
      // We need orthoWidth = width/2 * 1.1
      // orthoWidth = orthoTop * viewportRatio
      // So orthoTop = (width/2 * 1.1) / viewportRatio
      
      // If image aspect < viewportRatio, we are Height constrained.
      // orthoTop = height/2 * 1.1
      
      const imageAspect = width / height;
      
      let newOrthoTop = 30; // Default
      
      if (imageAspect > viewportRatio) {
          // Width constrained
          newOrthoTop = ((width / 2) * 1.1) / viewportRatio;
      } else {
          // Height constrained
          newOrthoTop = (height / 2) * 1.1;
      }
      
      this.planCamera.orthoTop = newOrthoTop;
      this.planCamera.orthoBottom = -newOrthoTop;
      this.planCamera.orthoLeft = -newOrthoTop * viewportRatio;
      this.planCamera.orthoRight = newOrthoTop * viewportRatio;
  }

  private handlePointer(pointerInfo: any) {
    const { type, event } = pointerInfo;
    const evt = event as PointerEvent;
    
    // Determine active camera/viewport based on mouse X/Y
    const canvas = this.engine.getRenderingCanvas();
    if (!canvas) return;
    const isPlanView = evt.offsetX < canvas.clientWidth * 0.65;
    const isElevationView = !isPlanView && evt.offsetY > canvas.clientHeight * 0.5;
    
    // Input Switching Logic
    let newViewport: 'plan' | 'iso' | 'elevation' = 'iso';
    if (isPlanView) newViewport = 'plan';
    else if (isElevationView) newViewport = 'elevation';

    // Only switch on MOVE to avoid jitter during clicks, but actually needed for DOWN too
    // Block switching if App is dragging (e.g. guide lines)
    if (!this.isAppDragging && this.activeViewport !== newViewport) {
        this.activeViewport = newViewport;
        if (this.onActiveViewportChange) {
            this.onActiveViewportChange(newViewport);
        }
        
        // Detach All
        this.isoCamera.detachControl();
        this.elevationCamera.detachControl();
        
        // Attach Active
        if (newViewport === 'iso') {
            this.isoCamera.attachControl(canvas, true);
        } else if (newViewport === 'elevation') {
            this.elevationCamera.attachControl(canvas, true);
        }
    }
    
    // Pick active camera for Raycasting
    let camera: Camera = this.isoCamera;
    if (isPlanView) camera = this.planCamera;
    else if (isElevationView) camera = this.elevationCamera;

    // Handle Scroll (Zoom) for Elevation View
    if (type === PointerEventTypes.POINTERWHEEL && isElevationView) {
        const wheelEvt = evt as unknown as WheelEvent;
        wheelEvt.preventDefault();
        wheelEvt.stopPropagation();

        const delta = wheelEvt.deltaY;
        const zoomFactor = 0.001;
        
        this.elevationZoom += delta * zoomFactor;
        // Clamp Zoom (Smaller value = Zoom In)
        this.elevationZoom = Math.max(0.1, Math.min(this.elevationZoom, 5));
        
        // Update Ortho Bounds
        const orthoSize = 30 * this.elevationZoom;
        const ratio = this.engine.getRenderWidth() / this.engine.getRenderHeight();
        
        this.elevationCamera.orthoTop = orthoSize;
        this.elevationCamera.orthoBottom = -orthoSize;
        this.elevationCamera.orthoLeft = -orthoSize * 0.35 * ratio;
        this.elevationCamera.orthoRight = orthoSize * 0.35 * ratio;
        
        return; // Consume event
    }

    // Re-pick with correct camera
    const ray = this.scene.createPickingRay(this.scene.pointerX, this.scene.pointerY, Matrix.Identity(), camera);
    
    // 1. Priority Pick: Try to pick handles first (ignoring buildings/ground)
    let hit = this.scene.pickWithRay(ray, (mesh) => {
        // Allow picking invisible handles if they are guides (colliders)
        // BUT strictly block guides if we are in Plan View (camera === this.planCamera)
        if (camera === this.planCamera && mesh.metadata?.handleType === 'guide') return false;
        
        return (mesh.isVisible || mesh.metadata?.handleType === 'guide') && mesh.isPickable && mesh.metadata?.type === 'handle' && (mesh.layerMask & camera.layerMask) !== 0;
    });

    // 2. Fallback Pick: If no handle hit, pick everything else
    if (!hit || !hit.hit) {
        hit = this.scene.pickWithRay(ray, (mesh) => {
            return (mesh.layerMask & camera.layerMask) !== 0;
        });
    }
    
    if (type === PointerEventTypes.POINTERDOWN) {
      if (evt.button !== 0) return;

      if (this.activeTool.startsWith("add_")) {
        if (hit && hit.pickedPoint) {
          this.createBuilding(hit.pickedPoint, this.activeTool === "add_flat" ? RoofType.Flat : RoofType.Gable);
          this.setTool("select");
          if (this.previewMesh) {
            this.previewMesh.dispose();
            this.previewMesh = null;
          }
        }
      } else if (this.activeTool === "select") {
        if (hit && hit.pickedMesh) {
          if (hit.pickedMesh.metadata?.type === "handle") {
            const handleType = hit.pickedMesh.metadata.handleType;
            
            // Disable scaling and rotation handles in Elevation View
            if (this.activeViewport === 'elevation' &&
                (handleType === 'corner' || handleType === 'edge_width' || 
                 handleType === 'edge_depth' || handleType === 'rotate')) {
                return; // Do not initiate drag for these handles
            }

            this.isDragging = true;
            this.dragTarget = hit.pickedMesh;
            this.draggingHandleType = handleType || "corner";
            
            this.isoCamera.detachControl();

            // Calculate drag offset (Vector from pick point to handle center)
            if (hit.pickedPoint) {
                const handlePos = this.dragTarget.absolutePosition.clone();
                this.dragOrigin = handlePos.subtract(hit.pickedPoint);
            }

          } else if (hit.pickedMesh.metadata?.type === "building") {
             this.selectBuilding(hit.pickedMesh as Mesh);
             
             // NEW: Relocate Building (Only in 2D Plan View)
             if (isPlanView && this.selectedMesh) {
                 this.isDragging = true;
                 this.draggingBuilding = this.selectedMesh;
                 this.dragTarget = null; // Ensure no handle is targeted
                 this.isoCamera.detachControl(); // Disable 3D camera rotation
                 
                 if (hit.pickedPoint) {
                     const bPos = this.draggingBuilding.position.clone();
                     bPos.y = 0;
                     this.dragOrigin = bPos.subtract(hit.pickedPoint);
                 }
             }

          } else {
             this.selectBuilding(null);
          }
        }
      }
    } else if (type === PointerEventTypes.POINTERUP) {
      if (this.isDragging) {
        this.isDragging = false;
        this.dragTarget = null;
        this.draggingBuilding = null;
        this.draggingHandleType = null;
        this.dragOrigin = null;
        this.isoCamera.attachControl(this.engine.getRenderingCanvas(), true);
      }
            } else if (type === PointerEventTypes.POINTERMOVE) {
              // Hover Logic for Handles
              if (hit && hit.pickedMesh && hit.pickedMesh.metadata?.type === 'handle') {
                  if (this.hoveredHandle !== hit.pickedMesh) {
                      // Reset old hover
                      if (this.hoveredHandle && !this.hoveredHandle.isDisposed()) {
                           if (this.hoveredHandle.metadata?.handleType === 'guide') {
                               const md = this.hoveredHandle.metadata;
                               if (md && md.visualDashed) md.visualDashed.metadata.isActive = true;
                               if (md && md.visualSolid) md.visualSolid.metadata.isActive = false;
                           } else {
                               // Reset scaling
                               const base = this.hoveredHandle.metadata?.baseScale || 1;
                               this.hoveredHandle.scaling.setAll(base);
                           }
                      }
                      
                      // Set new hover
                      this.hoveredHandle = hit.pickedMesh;
                      
                      if (this.hoveredHandle.metadata?.handleType === 'guide') {
                           const md = this.hoveredHandle.metadata;
                           if (md && md.visualDashed) md.visualDashed.metadata.isActive = false;
                           if (md && md.visualSolid) md.visualSolid.metadata.isActive = true;
                      } else {
                           // Scale Up
                           const base = this.hoveredHandle.metadata?.baseScale || 1;
                           this.hoveredHandle.scaling.setAll(base * 1.3);
                      }
                  }
              } else {
                  // No handle hovered
                  if (this.hoveredHandle) {
                      if (!this.hoveredHandle.isDisposed()) {
                          if (this.hoveredHandle.metadata?.handleType === 'guide') {
                              const md = this.hoveredHandle.metadata;
                              if (md && md.visualDashed) md.visualDashed.metadata.isActive = true;
                              if (md && md.visualSolid) md.visualSolid.metadata.isActive = false;
                          } else {
                              // Reset scaling
                              const base = this.hoveredHandle.metadata?.baseScale || 1;
                              this.hoveredHandle.scaling.setAll(base);
                          }
                      }
                      this.hoveredHandle = null;
                  }
              }      if (this.activeTool.startsWith("add_")) {
        const roofType = this.activeTool === "add_flat" ? RoofType.Flat : RoofType.Gable;
        
        // Create preview mesh
        if (!this.previewMesh || this.previewMesh.metadata.roofType !== roofType) {
            if (this.previewMesh) this.previewMesh.dispose();
            
            this.previewMesh = new Mesh("preview_root", this.scene);
            this.previewMesh.metadata = { 
                type: "preview", 
                roofType: roofType,
                width: 10, depth: 6, height: 4, slope: 2
            };
            this.rebuildMesh(this.previewMesh);
            
            this.previewMesh.getChildren().forEach(c => {
                if (c instanceof AbstractMesh) {
                    c.visibility = 0.5;
                    c.isPickable = false;
                }
            });
            this.previewMesh.isPickable = false;
            // Preview is visible in Plan and Iso
            this.previewMesh.layerMask = MASK_PLAN | MASK_ISO;
            this.previewMesh.getChildren().forEach(c => { if(c instanceof AbstractMesh) c.layerMask = MASK_PLAN | MASK_ISO; });
        }

        if (hit && hit.pickedPoint) {
           this.previewMesh.position = hit.pickedPoint;
           this.previewMesh.position.y = 0;
        }
      } else if (this.isDragging) {
         // Determine Drag Plane based on View
         let dragPlane = Plane.FromPositionAndNormal(Vector3.Zero(), Vector3.Up()); // Default Ground
         
         if (this.activeViewport === 'elevation' && this.elevationCamera && this.selectedMesh) {
             const target = this.selectedMesh.position;
             const camForward = this.elevationCamera.position.subtract(target).normalize();
             dragPlane = Plane.FromPositionAndNormal(target, camForward);
         }

         const ray = this.scene.createPickingRay(this.scene.pointerX, this.scene.pointerY, Matrix.Identity(), camera);
         const dist = ray.intersectsPlane(dragPlane);
         let dragPoint = null;
         
         if (dist) {
             dragPoint = ray.origin.add(ray.direction.scale(dist));
         }

         if (dragPoint && this.dragOrigin) {
             dragPoint.addInPlace(this.dragOrigin);
         }

         if (this.dragTarget && dragPoint) {
             if (this.draggingHandleType === "corner" || 
                 this.draggingHandleType === "edge_width" || 
                 this.draggingHandleType === "edge_depth") {
                 this.handleResize(dragPoint);
                 this.updateElevationCamera();
                 this.notifyDimensions();
             } else if (this.draggingHandleType === "rotate" && this.selectedMesh) {
                 const dx = dragPoint.x - this.selectedMesh.position.x;
                 const dz = dragPoint.z - this.selectedMesh.position.z;
                 const angle = Math.atan2(dx, dz);
                 this.selectedMesh.rotation.y = angle;
             } else if (this.draggingHandleType === "height_eaves") {
                 this.setEavesHeight(dragPoint.y);
             } else if (this.draggingHandleType === "height_ridge") {
                 this.setRidgeHeight(dragPoint.y);
             }
         } else if (this.draggingBuilding && dragPoint) {
             // Relocate Building Logic
             this.draggingBuilding.position.x = dragPoint.x;
             this.draggingBuilding.position.z = dragPoint.z;
             this.updateElevationCamera();
         }
      }
    }
  }

    private createBuilding(position: Vector3, type: RoofType) {
      const root = new Mesh("building_root", this.scene);
      root.position = position;
      root.position.y = 0;
      root.metadata = { 
          type: "building", 
          roofType: type,
                                  width: 10, depth: 6, 
                                  height: type === RoofType.Flat ? 5 : 4, // Initial height (eaves)
                                  slope: type === RoofType.Flat ? 25 : 2 
                              };    this.rebuildMesh(root);
    this.buildings.push(root);
    
    // Default: Visible in Plan (1) and Iso (2) -> 0x3
    root.layerMask = MASK_PLAN | MASK_ISO;
    root.getChildren().forEach(c => { if (c instanceof AbstractMesh) c.layerMask = MASK_PLAN | MASK_ISO; });

    this.selectBuilding(root);
  }

  private rebuildMesh(root: Mesh) {
    root.getChildren().forEach(c => c.dispose());
    
    const { width, depth, height, roofType, slope } = root.metadata;

    // Base
    const base = MeshBuilder.CreateBox("base", { width, depth, height }, this.scene);
    base.position.y = height / 2;
    base.parent = root;
    base.material = this.getBuildingMaterial();

    let roof: Mesh;
    if (roofType === RoofType.Flat) {
       roof = MeshBuilder.CreateBox("roof_flat", { width: width + 0.5, depth: depth + 0.5, height: 0.5 }, this.scene);
       roof.position.y = height + 0.25;
    } else {
       // Gable Roof using ExtrudeShape (rotated)
       const triShape = [
           new Vector3(-depth/2, 0, 0),
           new Vector3(depth/2, 0, 0),
           new Vector3(0, slope, 0),
           new Vector3(-depth/2, 0, 0)
       ];
       
       const tempRoof = MeshBuilder.ExtrudeShape("roof", {
           shape: triShape,
           path: [new Vector3(0, 0, -width/2), new Vector3(0, 0, width/2)],
           cap: Mesh.CAP_ALL
       }, this.scene);
       
       tempRoof.rotation.y = Math.PI / 2;
       tempRoof.position.y = height;
       roof = tempRoof;
    }
    
    roof.parent = root;
    roof.material = this.getRoofMaterial();
    
    base.isPickable = true;
    roof.isPickable = true;
    base.metadata = { type: "building" };
    roof.metadata = { type: "building" };
  }

  private getBuildingMaterial() {
    const mat = new StandardMaterial("mat_wall", this.scene);
    mat.diffuseColor = Color3.White();
    return mat;
  }
  
  private getRoofMaterial() {
    const mat = new StandardMaterial("mat_roof", this.scene);
    mat.diffuseColor = new Color3(0.8, 0.4, 0.3);
    return mat;
  }

  private selectBuilding(mesh: Nullable<Mesh>) {
    let root = mesh;
    while(root && root.parent && root.parent instanceof Mesh && root.metadata?.type !== 'building') {
        root = root.parent as Mesh;
    }
    if (root && root.parent) root = root.parent as Mesh;

    if (this.selectedMesh === root) return;
    
    this.selectedMesh = root;
    
    // Update Layer Masks for Isolation
    this.buildings.forEach(b => {
        // Selected: Plan + Iso + Elevation (1|2|4 = 7)
        // Others: Plan + Iso (1|2 = 3)
        const mask = (b === this.selectedMesh) ? (MASK_PLAN | MASK_ISO | MASK_ELEVATION) : (MASK_PLAN | MASK_ISO);
        b.layerMask = mask;
        b.getChildren().forEach(c => {
            if (c instanceof AbstractMesh) c.layerMask = mask;
        });
    });

    this.createHandles();
    
    this.updateElevationCamera();
    this.notifyDimensions(); // Sync UI

    if (this.onSelectionChange) {
        this.onSelectionChange(root);
    }
  }

  private createHandles() {
    this.handles.forEach(h => h.dispose());
    this.handles = [];
    
    if (!this.selectedMesh) return;
    
    const { width, depth, height, slope, roofType } = this.selectedMesh.metadata;

    // Position handles above the roof to ensure they are picked first in Plan View
    const yPos = height + slope + 1;

    // Calculate scale based on orthoTop to ensure usable size
    const currentOrtho = this.planCamera.orthoTop || 30;
    const baseScale = currentOrtho / 30;
    const baseHandleSize = 0.75; // Geometry size

    // Helper to set mask for Standard Handles (Plan Only)
    const setHandleMask = (mesh: Mesh) => {
        mesh.layerMask = MASK_PLAN; // Only visible in Plan View
        mesh.scaling.setAll(baseScale);
    };

    // 1. Corner Handles (Spheres)
    const positions = [
        new Vector3(-width/2, yPos, -depth/2),
        new Vector3(width/2, yPos, -depth/2),
        new Vector3(width/2, yPos, depth/2),
        new Vector3(-width/2, yPos, depth/2),
    ];
    
    positions.forEach((pos, idx) => {
        const handle = MeshBuilder.CreateSphere("handle_"+idx, { diameter: baseHandleSize }, this.scene);
        handle.position = pos;
        handle.parent = this.selectedMesh;
        handle.metadata = { type: "handle", handleType: "corner", index: idx, baseScale };
        handle.material = new StandardMaterial("mat_handle", this.scene);
        (handle.material as StandardMaterial).diffuseColor = Color3.Yellow();
        (handle.material as StandardMaterial).alpha = 1.0;
        setHandleMask(handle);
        this.handles.push(handle);
    });

    // 2. Edge Handles (Boxes)
    const matEdge = new StandardMaterial("mat_handle_edge", this.scene);
    matEdge.diffuseColor = Color3.Yellow();
    matEdge.alpha = 1.0;

    // Width Handles (Left/Right) - Control Width (X-axis)
    // Placed at +/- Width/2, Z=0. Shape elongated along Z.
    const widthHandles = [
        { pos: new Vector3(-width/2, yPos, 0) },
        { pos: new Vector3(width/2, yPos, 0) }
    ];
    widthHandles.forEach((h, idx) => {
        // Reduced depth to prevent overlap with corners
        const handle = MeshBuilder.CreateBox("handle_width_"+idx, { width: baseHandleSize * 0.5, height: baseHandleSize * 0.5, depth: baseHandleSize * 1.5 }, this.scene);
        handle.position = h.pos;
        handle.parent = this.selectedMesh;
        handle.metadata = { type: "handle", handleType: "edge_width", index: idx, baseScale };
        handle.material = matEdge;
        setHandleMask(handle);
        this.handles.push(handle);
    });

    // Depth Handles (Front/Back) - Control Depth (Z-axis)
    // Placed at X=0, +/- Depth/2. Shape elongated along X.
    const depthHandles = [
        { pos: new Vector3(0, yPos, -depth/2) },
        { pos: new Vector3(0, yPos, depth/2) }
    ];
    depthHandles.forEach((h, idx) => {
        // Reduced width to prevent overlap with corners
        const handle = MeshBuilder.CreateBox("handle_depth_"+idx, { width: baseHandleSize * 1.5, height: baseHandleSize * 0.5, depth: baseHandleSize * 0.5 }, this.scene);
        handle.position = h.pos;
        handle.parent = this.selectedMesh;
        handle.metadata = { type: "handle", handleType: "edge_depth", index: idx, baseScale };
        handle.material = matEdge;
        setHandleMask(handle);
        this.handles.push(handle);
    });

    // 3. Roof Handles (Removed per user request)
    // Height control is now done via Elevation View sliders.

    // 4. Rotation Handle
    // Place it at a fixed distance from the back of the house (along Z axis)
    // Scale offset as well to prevent handle being inside building if building is large? 
    // Actually keep constant offset + some scaling
    const rotatePos = new Vector3(0, yPos, depth/2 + 4 * baseScale); 
    const rotateHandle = MeshBuilder.CreateCylinder("handle_rotate", { diameter: baseHandleSize * 2, height: baseHandleSize / 2 }, this.scene);
    rotateHandle.position = rotatePos;
    rotateHandle.parent = this.selectedMesh;
    rotateHandle.metadata = { type: "handle", handleType: "rotate", index: 0, baseScale };
    const matRotate = new StandardMaterial("mat_handle_rotate", this.scene);
    matRotate.diffuseColor = Color3.FromHexString("#3366FF"); // Blue
    matRotate.alpha = 1.0;
    rotateHandle.material = matRotate;
    setHandleMask(rotateHandle);
    this.handles.push(rotateHandle);

    // 5. Visual Guides (Dashed Lines) for Elevation View
    const guideColor = Color3.Gray();
    
    const createLevelGuide = (y: number, name: string, subType: 'eaves' | 'ridge') => {
        const size = 50;
        
        const pointsX = [new Vector3(-size, y, 0), new Vector3(size, y, 0)];
        const pointsZ = [new Vector3(0, y, -size), new Vector3(0, y, size)];
        
        // Dashed lines (default)
        const lineX_dashed = MeshBuilder.CreateDashedLines(name+"_x_dashed", { points: pointsX, dashSize: 1, gapSize: 1 }, this.scene);
        const lineZ_dashed = MeshBuilder.CreateDashedLines(name+"_z_dashed", { points: pointsZ, dashSize: 1, gapSize: 1 }, this.scene);
        
        lineX_dashed.color = guideColor;
        lineZ_dashed.color = guideColor;
        lineX_dashed.parent = this.selectedMesh;
        lineZ_dashed.parent = this.selectedMesh;
        lineX_dashed.layerMask = MASK_ELEVATION; // Elevation Only
        lineZ_dashed.layerMask = MASK_ELEVATION;
        
        lineX_dashed.metadata = { type: "handle", handleType: "guide", subType, isActive: true };
        lineZ_dashed.metadata = { type: "handle", handleType: "guide", subType, isActive: true };

        // Solid lines (on hover)
        const lineX_solid = MeshBuilder.CreateLines(name+"_x_solid", { points: pointsX }, this.scene);
        const lineZ_solid = MeshBuilder.CreateLines(name+"_z_solid", { points: pointsZ }, this.scene);
        
        lineX_solid.color = Color3.Blue(); // Make solid lines more distinct
        lineZ_solid.color = Color3.Blue();
        lineX_solid.parent = this.selectedMesh;
        lineZ_solid.parent = this.selectedMesh;
        lineX_solid.layerMask = MASK_ELEVATION; // Elevation Only
        lineZ_solid.layerMask = MASK_ELEVATION;
        
        lineX_solid.isVisible = false; // Initially invisible
        lineZ_solid.isVisible = false; // Initially invisible
        
        lineX_solid.metadata = { type: "handle", handleType: "guide", subType, isActive: false };
        lineZ_solid.metadata = { type: "handle", handleType: "guide", subType, isActive: false };

        // Invisible Colliders for easier picking
        const colliderX = MeshBuilder.CreateBox(name+"_col_x", { width: size * 2, height: 1, depth: 1 }, this.scene);
        colliderX.position.y = y;
        colliderX.visibility = 0; // Invisible but pickable
        colliderX.parent = this.selectedMesh;
        colliderX.layerMask = MASK_ELEVATION; // Elevation Only
        colliderX.metadata = { type: "handle", handleType: "guide", subType, visualDashed: lineX_dashed, visualSolid: lineX_solid };

        const colliderZ = MeshBuilder.CreateBox(name+"_col_z", { width: 1, height: 1, depth: size * 2 }, this.scene);
        colliderZ.position.y = y;
        colliderZ.visibility = 0;
        colliderZ.parent = this.selectedMesh;
        colliderZ.layerMask = MASK_ELEVATION; // Elevation Only
        colliderZ.metadata = { type: "handle", handleType: "guide", subType, visualDashed: lineZ_dashed, visualSolid: lineZ_solid };
        
        this.handles.push(lineX_dashed, lineZ_dashed, lineX_solid, lineZ_solid, colliderX, colliderZ);
    };

    createLevelGuide(height, "guide_eaves", 'eaves');
    
    if (roofType === RoofType.Gable) {
        const topH = height + slope;
        createLevelGuide(topH, "guide_ridge", 'ridge');
    }
  }

  private handleResize(pickPoint: Vector3) {
      if (!this.selectedMesh || !this.dragTarget) return;

      const handleType = this.dragTarget.metadata.handleType;
      const index = this.dragTarget.metadata.index;
      
      this.selectedMesh.computeWorldMatrix(true);
      
      // Transform pickPoint to Local Space
      // CRITICAL: Use clone() because invert() modifies in place and getWorldMatrix() returns a reference
      const inverseWorldMatrix = this.selectedMesh.getWorldMatrix().clone().invert();
      const localPickPoint = Vector3.TransformCoordinates(pickPoint, inverseWorldMatrix);

      // Current Local Boundaries (Centered at 0,0)
      const currentWidth = this.selectedMesh.metadata.width;
      const currentDepth = this.selectedMesh.metadata.depth;
      const halfWidth = currentWidth / 2;
      const halfDepth = currentDepth / 2;

      let minX = -halfWidth;
      let maxX = halfWidth;
      let minZ = -halfDepth;
      let maxZ = halfDepth;

      const MIN_SIZE = 1;

      // Update boundaries with strict clamping (No Swapping) using LOCAL coordinates
      if (handleType === "corner") {
          // Index 0: (-,-), 1: (+,-), 2: (+,+), 3: (-,+)
          // Left Side (0, 3)
          if (index === 0 || index === 3) {
              minX = Math.min(localPickPoint.x, maxX - MIN_SIZE);
          }
          // Right Side (1, 2)
          if (index === 1 || index === 2) {
              maxX = Math.max(localPickPoint.x, minX + MIN_SIZE);
          }
          // Back Side (0, 1)
          if (index === 0 || index === 1) {
              minZ = Math.min(localPickPoint.z, maxZ - MIN_SIZE);
          }
          // Front Side (2, 3)
          if (index === 2 || index === 3) {
              maxZ = Math.max(localPickPoint.z, minZ + MIN_SIZE);
          }
      } 
      else if (handleType === "edge_width") {
          // Index 0: Left (-X), 1: Right (+X)
          if (index === 0) {
              minX = Math.min(localPickPoint.x, maxX - MIN_SIZE);
          } else {
              maxX = Math.max(localPickPoint.x, minX + MIN_SIZE);
          }
      } 
      else if (handleType === "edge_depth") {
          // Index 0: Back (-Z), 1: Front (+Z)
          if (index === 0) {
              minZ = Math.min(localPickPoint.z, maxZ - MIN_SIZE);
          } else {
              maxZ = Math.max(localPickPoint.z, minZ + MIN_SIZE);
          }
      }

      // Apply new dimensions
      const newWidth = maxX - minX;
      const newDepth = maxZ - minZ;
      
      // Calculate the needed shift in Local Space
      // The new geometry will be centered at (0,0) of the NEW pivot.
      // The current geometry is centered at (0,0) of the OLD pivot.
      // The "geometric center" of our new bounds is at (midX, 0, midZ) relative to Old Pivot.
      // We want this geometric center to become the New Pivot (0,0).
      // So we must move the Pivot by (midX, 0, midZ).
      const localShift = new Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
      
      // Rotate this shift to World Space (ignoring translation)
      const worldShift = Vector3.TransformNormal(localShift, this.selectedMesh.getWorldMatrix());

      this.selectedMesh.metadata.width = newWidth;
      this.selectedMesh.metadata.depth = newDepth;
      
      // Apply the shift
      this.selectedMesh.position.addInPlace(worldShift);
      
      this.rebuildMesh(this.selectedMesh);
      this.createHandles();
      this.notifyDimensions();
      
      // Update dragTarget to the new handle instance
      if (this.isDragging && handleType && index !== undefined) {
          const newHandle = this.handles.find(h => 
              h.metadata.handleType === handleType && h.metadata.index === index
          );
          if (newHandle) {
              this.dragTarget = newHandle;
          }
      }
  }

  public setTool(tool: "select" | "add_flat" | "add_gable") {
    this.activeTool = tool;
    if (this.onToolChange) {
      this.onToolChange(tool);
    }
  }
  
    public setSlope(slope: number) {
  
                if (this.selectedMesh && this.selectedMesh.metadata.roofType === RoofType.Gable) {
  
                    const limitedSlope = Math.max(0.5, Math.min(30, slope));
  
                    this.selectedMesh.metadata.slope = limitedSlope;
  
            this.rebuildMesh(this.selectedMesh);
  
            this.createHandles(); // Re-attach handles if needed (though parent didn't die)

            if (this.onSlopeChange) {
                this.onSlopeChange(slope);
            }
  
        }
  
    }

    public setElevationView(direction: 'N' | 'S' | 'E' | 'W') {
        this.currentElevationDir = direction;
        this.updateElevationCamera();
    }

    public setEavesHeight(newHeight: number) {
        if (!this.selectedMesh) return;
        
        const oldHeight = this.selectedMesh.metadata.height;
        const oldSlope = this.selectedMesh.metadata.slope;
        const top = oldHeight + oldSlope;
        
        // Clamp height so it doesn't push the top up
        // Maintain a minimum slope of 0.5
        const maxAllowedHeight = top - 0.5;
        const clampedHeight = Math.min(newHeight, maxAllowedHeight);
        
        const newSlope = top - clampedHeight;
        
        this.selectedMesh.metadata.height = clampedHeight;
        this.selectedMesh.metadata.slope = newSlope;
        
        this.rebuildMesh(this.selectedMesh);
        this.createHandles();
        // this.updateElevationCamera(); // Removed to prevent snapping rotation
        this.notifyDimensions();
    }

    public setRidgeHeight(newTop: number) {
        if (!this.selectedMesh) return;
        
        const height = this.selectedMesh.metadata.height;
        let newSlope = newTop - height;
        if (newSlope < 0.5) newSlope = 0.5;
        
        this.selectedMesh.metadata.slope = newSlope;
        
        this.rebuildMesh(this.selectedMesh);
        this.createHandles();
        // this.updateElevationCamera(); // Removed to prevent snapping rotation
        this.notifyDimensions();
    }

    private notifyDimensions() {
        if (this.selectedMesh && this.onDimensionsChange) {
            const { width, depth, height, slope } = this.selectedMesh.metadata;
            this.onDimensionsChange(width, depth, height, slope);
        }
    }

    public pickGuide(x: number, y: number): 'eaves' | 'ridge' | null {
        // Only pick if in Elevation View mode
        if (this.activeViewport !== 'elevation') return null;
        
        // Guide meshes are layerMask 0x3 (so visible to Elevation 0x2).
        // But picking logic should use Elevation Camera if active.
        
        let camera: Camera = this.isoCamera;
        if (this.activeViewport === 'elevation') camera = this.elevationCamera;
        
        // scene.pick uses active camera? No, it uses the camera passed or defaults.
        // We must ensure we pick with the correct camera transformation.
        // scene.pick(x, y, predicate, false, camera)
        
        const hit = this.scene.pick(x, y, (mesh) => {
            return mesh.metadata?.handleType === 'guide';
        }, false, camera);

        if (hit && hit.hit && hit.pickedMesh) {
            return hit.pickedMesh.metadata.subType;
        }
        return null;
    }

    public refreshInput() {
        const canvas = this.engine.getRenderingCanvas();
        if (!canvas) return;
        
        const x = this.scene.pointerX;
        const y = this.scene.pointerY;
        
        const isPlanView = x < canvas.clientWidth * 0.65;
        const isElevationView = !isPlanView && y > canvas.clientHeight * 0.5;
        
        let newViewport: 'plan' | 'iso' | 'elevation' = 'iso';
        if (isPlanView) newViewport = 'plan';
        else if (isElevationView) newViewport = 'elevation';
        
        // Force update even if same? No, only if diff or to ensure consistency.
        // Let's force re-attach to be safe.
        
        this.activeViewport = newViewport;
        this.isoCamera.detachControl();
        this.elevationCamera.detachControl();
        
        if (newViewport === 'iso') {
            this.isoCamera.attachControl(canvas, true);
        } else if (newViewport === 'elevation') {
            this.elevationCamera.attachControl(canvas, true);
        }
        
        if (this.onActiveViewportChange) {
            this.onActiveViewportChange(newViewport);
        }
    }

    private updateElevationCamera() {
        if (!this.elevationCamera) return;

        const target = this.selectedMesh ? this.selectedMesh.position : Vector3.Zero();
        const dist = 100;
        let offset = new Vector3(0, 0, -dist);

        switch(this.currentElevationDir) {
            case 'N': offset = new Vector3(0, 0, dist); break;
            case 'S': offset = new Vector3(0, 0, -dist); break;
            case 'E': offset = new Vector3(dist, 0, 0); break;
            case 'W': offset = new Vector3(-dist, 0, 0); break;
        }

        this.elevationCamera.position = target.add(offset);
        this.elevationCamera.setTarget(target);
    }

    private updateGuidePositions() {
        if (!this.selectedMesh || !this.elevationCamera || !this.onGuidesPositionChange) {
            this.onGuidesPositionChange?.({ eaves: null, ridge: null, pixelsPerMeter: 1 });
            return;
        }

        // Only calculate if Elevation View is actually relevant? 
        // We probably want it always if selected, but strictly speaking only if visible.
        // But for simplicity, run it.

        const canvas = this.engine.getRenderingCanvas();
        if (!canvas) return;

        const { height, slope, roofType } = this.selectedMesh.metadata;
        
        // Calculate World Positions of the guide lines (at the center of the mesh)
        // Since it's orthographic, X/Z doesn't matter much for Y projection, 
        // but we need to be in front of the camera.
        const center = this.selectedMesh.position;
        
        const eavesPos = new Vector3(center.x, height, center.z);
        
        let ridgeY = height + slope;
        if (roofType === RoofType.Flat) ridgeY = height + 0.5;
        const ridgePos = new Vector3(center.x, ridgeY, center.z);

        const viewport = this.elevationCamera.viewport;
        const globalViewport = viewport.toGlobal(canvas.width, canvas.height);
        
        // We must use the Elevation Camera's matrices
        const transform = this.elevationCamera.getViewMatrix().multiply(this.elevationCamera.getProjectionMatrix());

        const project = (pos: Vector3) => {
            const p = Vector3.Project(
                pos,
                Matrix.Identity(),
                transform,
                globalViewport
            );
            return p;
        };

        const eavesScreen = project(eavesPos);
        const ridgeScreen = project(ridgePos);
        
        const dpr = window.devicePixelRatio || 1;
        
        // Relaxed visibility check: Always show if projected, let user see where it lands.
        // We can re-enable bounds later if it overlaps other views.
        const isVisible = () => true; 

        // Calculate Pixels Per Meter scale (CSS Pixels)
        const orthoHeight = this.elevationCamera.orthoTop! - this.elevationCamera.orthoBottom!;
        const cssViewportHeight = (canvas.height * viewport.height) / dpr;
        const pixelsPerMeter = cssViewportHeight / orthoHeight;
        
        const toCssCoords = (p: Vector3) => {
            // p.y is WebGL Bottom-Up (0 at bottom of viewport)
            // Project returns y relative to canvas bottom.
            // We need CSS Top-Down (0 at top of canvas).
            const physicalYFromTop = canvas.height - p.y;
            return { x: p.x / dpr, y: physicalYFromTop / dpr };
        }
        
        const eCSS = toCssCoords(eavesScreen);
        const rCSS = toCssCoords(ridgeScreen);

        // Debug Logs
        // console.log("Guide Pos Debug:", {
        //     eavesScreen, 
        //     visible: isVisible(),
        //     eCSS,
        //     dpr,
        //     canvasSize: { w: canvas.width, h: canvas.height },
        // });

        this.onGuidesPositionChange({
            eaves: isVisible() ? eCSS : null,
            ridge: isVisible() ? rCSS : null,
            pixelsPerMeter
        });
    }
  
    public dispose() {
  
        this.scene.dispose();
  
        this.engine.dispose();
  
    }
  
  }