export enum RoofType {
  Flat = 'Flat',
  Gable = 'Gable'
}

export interface BuildingConfig {
  width: number;
  height: number;
  depth: number;
  x: number;
  z: number;
  rotation: number;
  roofType: RoofType;
  slope?: number; // For Gable
}
