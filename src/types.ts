export type ElementRole = 'fire' | 'water';

export interface Player {
  x: number;
  y: number;
  vx: number;
  vy: number;
  role: ElementRole;
  face: { x: number; y: number };
  cool: number;
  ride: string | null;
  carrying: string | null;
}

export type EntityKind =
  | 'switch'
  | 'plate'
  | 'box'
  | 'gate'
  | 'hazard'
  | 'ferry'
  | 'socket'
  | 'sync'
  | 'exit'
  | 'fragment'
  | 'core'
  | 'barrier'
  | 'checkpoint'
  | 'drone'
  | 'pulseLaser'
  | 'conveyor';

export interface Entity {
  kind: EntityKind;
  id: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  role?: ElementRole;
  req?: string;
  off?: string;
  carrier?: number | null;
  boxOnly?: boolean;
  toggle?: boolean;
  timer?: number;
  type?: 'ice' | 'vine' | 'laser' | 'heat' | 'water' | 'pulse';
  label?: string;
  noCargo?: boolean;
  a?: { x: number; y: number };
  b?: { x: number; y: number };
  side?: number;
  trip?: {
    from: { x: number; y: number };
    to: { x: number; y: number };
    t: number;
    duration: number;
    riders: number[];
  } | null;
  charge?: number;
  duration?: number;
  done?: boolean;
  radius?: number;
  // Volume 2 New Mechanics
  speed?: number;
  dir?: number; // 1 = forward, -1 = reverse
  progress?: number;
  period?: number;
  duty?: number; // active fraction (0..1)
  timeOffset?: number;
  dx?: number; // conveyor direction x (-1, 0, 1)
  dy?: number; // conveyor direction y (-1, 0, 1)
}

export interface LevelDef {
  title: string;
  idea: string;
  goal: string;
  tip: string;
  rooms: [number, number, number, number][]; // [x, y, w, h]
  starts: [number, number][];
  entities: Entity[];
  win: string;
  holes?: [number, number, number, number][];
  walls?: [number, number, number, number][];
  hints?: string[];
  safePit?: boolean;
  phases?: LevelDef[];
  entitiesExtra?: Entity[];
  proof?: any[];
  volume?: number; // 1 or 2
}

export interface SaveState {
  unlocked: number;
  unlockedVol2: number;
  currentVolume: 1 | 2;
  finished: boolean;
  fragments: string[];
  last: number;
  phase: number;
  music: boolean;
  sfx: boolean;
  volume: number;
  droneSpeedMultiplier: number;
}
