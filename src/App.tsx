import React, { useEffect, useRef, useState } from 'react';
import { VOLUME_1_LEVELS } from './levels/volume1.ts';
import { VOLUME_2_LEVELS } from './levels/volume2.ts';
import { Entity, LevelDef, Player, SaveState } from './types.ts';
import {
  Volume2,
  VolumeX,
  Play,
  RotateCcw,
  Pause,
  HelpCircle,
  Award,
  Layers,
  ShieldAlert,
  Flame,
  Droplets,
  ArrowRight,
  Sparkles,
  CheckCircle,
  ChevronRight
} from 'lucide-react';

const C = {
  fire: '#ff9459',
  water: '#66d5ef',
  both: '#c5a2fa',
  ok: '#a5e0b7',
  danger: '#ff6074',
};

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));
const cell = (x: number, y: number) => `${x},${y}`;
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const at = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  a.x === b.x && a.y === b.y;

// All levels combined:
// 0..12: Volume 1 (13 levels)
// 13..22: Volume 2 (10 levels, starting with Sector 14)
const ALL_LEVELS: LevelDef[] = [...VOLUME_1_LEVELS, ...VOLUME_2_LEVELS];

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // High-level UI state
  const [currentMode, setCurrentMode] = useState<
    'menu' | 'select' | 'play' | 'pause' | 'help' | 'won' | 'dead'
  >('menu');
  const [activeVolume, setActiveVolume] = useState<1 | 2>(1);
  const [levelIndex, setLevelIndex] = useState(0);
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [hudNotice, setHudNotice] = useState<string>('');
  const [showNotice, setShowNotice] = useState(false);
  const [deathReason, setDeathReason] = useState('');
  const [fpsText, setFpsText] = useState('60 fps');
  const [hintIndex, setHintIndex] = useState(0);

  // Audio settings
  const [isMusicOn, setIsMusicOn] = useState(true);
  const [isSfxOn, setIsSfxOn] = useState(true);
  const [volumeLevel, setVolumeLevel] = useState(0.3);
  const [droneSpeed, setDroneSpeed] = useState<number>(1.0);

  // HUD live data
  const [hudHeader, setHudHeader] = useState({
    chapter: 'СЕКТОР 01 / 13',
    title: 'Станция «Люмен»',
    goal: '',
    progress: '',
    tip: '',
    fireContext: '',
    waterContext: '',
  });

  // Persistent Save
  const saveRef = useRef<SaveState>({
    unlocked: 0,
    unlockedVol2: 0,
    currentVolume: 1,
    finished: false,
    fragments: [],
    last: 0,
    phase: 0,
    music: true,
    sfx: true,
    volume: 0.3,
    droneSpeedMultiplier: 1.0,
  });

  // Engine state refs
  const engineRef = useRef({
    mode: 'menu' as 'menu' | 'select' | 'play' | 'pause' | 'help' | 'won' | 'dead',
    index: 0,
    phase: 0,
    L: ALL_LEVELS[0] as LevelDef,
    ents: [] as Entity[],
    players: [] as Player[],
    flags: {} as Record<string, boolean>,
    timers: {} as Record<string, number>,
    floor: new Set<string>(),
    walls: new Set<string>(),
    pit: new Set<string>(),
    checkpoint: null as any,
    cpId: '',
    clock: 0,
    levelTime: 0,
    winHold: 0,
    deathLeft: 0,
    noticeLeft: 0,
    testing: false,
    manual: false,
    view: { w: 0, h: 0, s: 32, x: 0, y: 0 },
    keys: new Set<string>(),
    held: [false, false],
    lastTime: 0,
    accumulator: 0,
    doorStates: new Map<any, boolean>(),
    stats: { deaths: 0 },
    seenTips: new Set<string>(),
  });

  // Web Audio Synth
  const audioRef = useRef<{
    ctx: AudioContext | null;
    musicBus: GainNode | null;
    sfxBus: GainNode | null;
    noise: AudioBuffer | null;
    next: number;
    step: number;
  }>({
    ctx: null,
    musicBus: null,
    sfxBus: null,
    noise: null,
    next: 0,
    step: 0,
  });

  // Load saved state
  useEffect(() => {
    try {
      const stored = localStorage.getItem('echo_conduit_v4');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && typeof parsed === 'object') {
          saveRef.current = {
            ...saveRef.current,
            ...parsed,
            unlocked: Math.max(0, Number(parsed.unlocked) || 0),
            unlockedVol2: Math.max(0, Number(parsed.unlockedVol2) || 0),
            currentVolume: parsed.currentVolume === 2 ? 2 : 1,
            music: parsed.music !== false,
            sfx: parsed.sfx !== false,
            volume: Math.max(0, Math.min(1, Number(parsed.volume) || 0.3)),
            droneSpeedMultiplier: Number(parsed.droneSpeedMultiplier) || 1.0,
          };
          setIsMusicOn(saveRef.current.music);
          setIsSfxOn(saveRef.current.sfx);
          setVolumeLevel(saveRef.current.volume);
          setActiveVolume(saveRef.current.currentVolume);
          setDroneSpeed(saveRef.current.droneSpeedMultiplier);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  const persist = () => {
    try {
      localStorage.setItem('echo_conduit_v4', JSON.stringify(saveRef.current));
    } catch {
      // ignore
    }
  };

  // Audio helpers
  const initAudio = () => {
    if (engineRef.current.testing) return;
    try {
      const a = audioRef.current;
      if (!a.ctx) {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioCtx) return;
        a.ctx = new AudioCtx();
        const comp = a.ctx.createDynamicsCompressor();
        comp.threshold.value = -18;
        comp.ratio.value = 5;
        comp.connect(a.ctx.destination);

        a.musicBus = a.ctx.createGain();
        a.sfxBus = a.ctx.createGain();
        a.musicBus.connect(comp);
        a.sfxBus.connect(comp);

        a.noise = a.ctx.createBuffer(1, a.ctx.sampleRate * 0.18, a.ctx.sampleRate);
        const data = a.noise.getChannelData(0);
        let seed = 17;
        for (let i = 0; i < data.length; i++) {
          seed = (seed * 16807) % 2147483647;
          data[i] = ((seed / 2147483647) * 2 - 1) * 0.5;
        }
        a.next = a.ctx.currentTime + 0.08;
      }
      if (a.ctx.state === 'suspended') {
        a.ctx.resume().catch(() => {});
      }
      updateAudioGain();
    } catch {
      // ignore
    }
  };

  const updateAudioGain = () => {
    const a = audioRef.current;
    if (a.ctx && a.musicBus && a.sfxBus) {
      const targetMusic =
        saveRef.current.music && engineRef.current.mode === 'play'
          ? saveRef.current.volume * 0.45
          : 0;
      a.musicBus.gain.setTargetAtTime(targetMusic, a.ctx.currentTime, 0.05);
      a.sfxBus.gain.setTargetAtTime(
        saveRef.current.sfx ? 0.25 : 0,
        a.ctx.currentTime,
        0.02
      );
    }
  };

  const playTone = (
    freq: number,
    t: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    bus: GainNode,
    endFreq?: number
  ) => {
    const a = audioRef.current.ctx;
    if (!a) return;
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t + dur);

    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(gain);
    gain.connect(bus);
    osc.start(t);
    osc.stop(t + dur + 0.02);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  };

  const playSfx = (kind: 'act' | 'open' | 'ok' | 'danger' | 'death' | 'win') => {
    const a = audioRef.current;
    if (!a.ctx || !saveRef.current.sfx || engineRef.current.testing) return;
    const t = a.ctx.currentTime;
    const bus = a.sfxBus!;
    const seq =
      {
        act: [330, 440],
        open: [240, 480, 720],
        ok: [440, 660],
        danger: [150, 120],
        death: [180, 100, 55],
        win: [330, 440, 554, 660, 880],
      }[kind] || [440];
    seq.forEach((f, i) =>
      playTone(f, t + i * 0.085, kind === 'death' ? 0.3 : 0.16, 'sine', 0.2, bus)
    );
  };

  const notify = (text: string, sec = 4) => {
    setHudNotice(text);
    setShowNotice(true);
    engineRef.current.noticeLeft = sec;
  };

  const rectSet = (set: Set<string>, arr: [number, number, number, number][]) => {
    for (const [x, y, w, h] of arr) {
      for (let j = y; j < y + h; j++) {
        for (let i = x; i < x + w; i++) {
          set.add(cell(i, j));
        }
      }
    }
  };

  // Signal & Requirements
  const getSignal = (id: string): boolean => {
    const e = engineRef.current;
    if (e.flags[id]) return true;
    if (e.timers[id] > e.clock) return true;
    const matching = e.ents.filter((item) => item.id === id);
    for (const item of matching) {
      if (item.kind === 'plate') {
        const crate = e.ents.some(
          (b) => b.kind === 'box' && b.carrier === null && at(b, item)
        );
        const person = e.players.some(
          (p) => !p.ride && at(p, item) && (!item.role || p.role === item.role)
        );
        if (crate || (!item.boxOnly && person)) return true;
      }
      if (
        item.kind === 'socket' &&
        e.ents.some((b) => b.kind === 'box' && b.carrier === null && at(b, item))
      ) {
        return true;
      }
    }
    return false;
  };

  const checkReq = (s?: string): boolean => {
    if (!s) return true;
    return s.split('|').some((part) =>
      part.split('&').every((k) => (k[0] === '!' ? !getSignal(k.slice(1)) : getSignal(k)))
    );
  };

  const isInside = (e: { x: number; y: number; w?: number; h?: number }, x: number, y: number) => {
    return x >= e.x && y >= e.y && x < e.x + (e.w || 1) && y < e.y + (e.h || 1);
  };

  const isBlocked = (x: number, y: number, p: Player, ignoreBox = false): boolean => {
    const e = engineRef.current;
    if (!e.floor.has(cell(x, y))) return true;
    if (e.L.safePit && e.pit.has(cell(x, y))) return true;

    for (const item of e.ents) {
      if (item.kind === 'barrier' && !e.flags[item.id] && isInside(item, x, y)) return true;
      if (item.kind === 'gate' && isInside(item, x, y)) {
        if (item.noCargo && p.carrying) return true;
        if (item.role && p.role !== item.role) return true;
        if (!item.role && !checkReq(item.req)) {
          if (!isInside(item, p.x, p.y)) return true;
        }
      }
      if (
        !ignoreBox &&
        item.kind === 'box' &&
        item.carrier === null &&
        item.x === x &&
        item.y === y &&
        !at(p, item)
      ) {
        return true;
      }
    }
    return false;
  };

  const getDangerReason = (x: number, y: number, p: Player): string => {
    const e = engineRef.current;
    if (e.pit.has(cell(x, y)) && !e.L.safePit) return 'Падение в разлом';

    for (const item of e.ents) {
      // Standard hazards
      if (item.kind === 'hazard' && isInside(item, x, y) && !(item.off && checkReq(item.off))) {
        if (item.type === 'laser') return 'Защитный лазер';
        if (item.type === 'heat' && p.role === 'water') return 'Вода попала в перегретую зону';
        if (item.type === 'water' && p.role === 'fire') return 'Огонь попал в резервуар';
      }
      // Volume 2: Pulse Laser hazard
      if (item.kind === 'pulseLaser' && isInside(item, x, y)) {
        const isOff = item.off && checkReq(item.off);
        if (!isOff) {
          const period = item.period || 3.5;
          const duty = item.duty || 0.45;
          const activeDuration = period * duty;
          const cycle = (e.clock + (item.timeOffset || 0)) % period;
          if (cycle < activeDuration) {
            return 'Пульсирующий лазер';
          }
        }
      }
      // Volume 2: Drone hazard
      if (item.kind === 'drone' && !(item.off && checkReq(item.off))) {
        const droneDist = Math.hypot(p.x - item.x, p.y - item.y);
        if (droneDist < 0.85) {
          return 'Столкновение с патрульным дроном';
        }
      }
    }
    return '';
  };

  const die = (reason: string) => {
    const e = engineRef.current;
    if (e.mode !== 'play') return;
    e.mode = 'dead';
    e.deathLeft = 2;
    e.stats.deaths++;
    e.keys.clear();
    e.held.fill(false);
    setDeathReason(reason + (e.cpId ? ' · возврат к чекпоинту' : ''));
    setCurrentMode('dead');
    playSfx('death');
    updateAudioGain();
  };

  const movePlayer = (n: number, dx: number, dy: number): boolean => {
    const e = engineRef.current;
    const p = e.players[n];
    if (e.mode !== 'play' || p.ride) return false;
    p.face = { x: dx, y: dy };
    const nx = p.x + dx;
    const ny = p.y + dy;
    if (isBlocked(nx, ny, p)) return false;
    p.x = nx;
    p.y = ny;

    if (p.carrying) {
      const b = e.ents.find((item) => item.kind === 'box' && item.id === p.carrying);
      if (b) {
        b.x = nx;
        b.y = ny;
      }
    }

    const reason = getDangerReason(nx, ny, p);
    if (reason) die(reason);
    return true;
  };

  const getNearestTarget = (n: number): any => {
    const e = engineRef.current;
    const p = e.players[n];
    if (p.carrying) {
      const lift = e.ents.find(
        (item) => item.kind === 'ferry' && !item.trip && (at(p, item.a!) || at(p, item.b!))
      );
      if (lift) return lift;
      return { kind: 'drop', id: p.carrying, x: p.x, y: p.y };
    }

    const list: any[] = [];
    for (const item of e.ents) {
      let d = dist(p, item);
      if (item.kind === 'ferry') {
        d = Math.min(dist(p, item.a!), dist(p, item.b!));
        if (!item.trip && d <= 1) {
          list.push({
            e: item,
            d,
            priority: at(p, item.a!) || at(p, item.b!) ? 0 : 4,
          });
        }
        continue;
      }
      if (d > 1) continue;
      if (item.kind === 'box' && item.carrier === null) {
        list.push({ e: item, d, priority: 1 });
      }
      if (
        (item.kind === 'switch' && (!e.flags[item.id] || item.toggle || item.timer)) ||
        (item.kind === 'barrier' && !e.flags[item.id])
      ) {
        list.push({ e: item, d, priority: 2 });
      }
      if (item.kind === 'sync' && !e.flags[item.id] && at(p, item)) {
        list.push({ e: item, d, priority: 0 });
      }
    }

    const isFacing = (target: any) =>
      target.x === p.x + p.face.x && target.y === p.y + p.face.y ? 1 : 0;
    list.sort(
      (a, b) => a.d - b.d || isFacing(b.e) - isFacing(a.e) || a.priority - b.priority
    );
    return list.length ? list[0].e : null;
  };

  const actPlayer = (n: number): boolean => {
    const e = engineRef.current;
    if (e.mode !== 'play') return false;
    const p = e.players[n];
    if (p.ride) return false;
    const target = getNearestTarget(n);
    if (!target) return false;

    if (target.kind === 'drop') {
      if (
        e.ents.some(
          (b) => b.kind === 'box' && b.carrier === null && at(b, p)
        )
      ) {
        notify('Здесь уже стоит куб. Сделайте шаг в сторону.');
        return false;
      }
      const b = e.ents.find(
        (item) => item.kind === 'box' && item.id === p.carrying
      );
      if (b) {
        b.carrier = null;
        b.x = p.x;
        b.y = p.y;
      }
      p.carrying = null;
      playSfx('act');
      return true;
    }

    if (target.kind === 'box') {
      if (
        e.ents.some(
          (g) => g.kind === 'gate' && g.noCargo && isInside(g, p.x, p.y)
        )
      ) {
        notify('Фильтр Ø: здесь нельзя нести или поднимать груз.', 3);
        return false;
      }
      target.carrier = n;
      p.carrying = target.id;
      playSfx('act');
      return true;
    }

    if (target.role && target.role !== p.role) {
      notify(
        target.role === 'fire' ? 'Нужен Огонь · F' : 'Нужна Вода · Enter',
        2
      );
      playSfx('danger');
      return false;
    }

    if (target.req && !checkReq(target.req)) {
      notify(
        'Сначала нужен контур ' + target.req.replaceAll('&', ' + '),
        2
      );
      return false;
    }

    if (target.kind === 'sync') return true;

    if (target.kind === 'ferry') {
      const dock = dist(p, target.a!) <= dist(p, target.b!) ? target.a! : target.b!;
      const desired = at(dock, target.a!) ? 0 : 1;
      const has = target.side === desired;
      const riders = has
        ? e.players
            .map((q, idx) => (at(q, dock) && !q.ride ? idx : -1))
            .filter((idx) => idx >= 0)
        : [];
      if (has && !riders.length) {
        notify('Встаньте прямо на платформу и нажмите действие.', 2);
        return false;
      }
      const dest = has ? (target.side === 0 ? target.b! : target.a!) : dock;
      target.trip = {
        from: { x: target.x, y: target.y },
        to: clone(dest),
        t: 0,
        duration: 1.4,
        riders,
      };
      for (const k of riders) e.players[k].ride = target.id;
      playSfx('open');
      return true;
    }

    if (target.timer) {
      e.timers[target.id] = e.clock + target.timer;
      notify(`Контур ${target.id}: ${target.timer} секунд`, 2);
    } else {
      e.flags[target.id] = target.toggle ? !e.flags[target.id] : true;
      notify(
        target.kind === 'barrier'
          ? target.type === 'ice'
            ? 'Лёд растоплен'
            : 'Лианы сожжены'
          : `Контур ${target.id} зафиксирован`,
        2
      );
    }
    playSfx('ok');
    return true;
  };

  const snapshotCheckpoint = (id: string, announce = true) => {
    const e = engineRef.current;
    e.checkpoint = {
      flags: clone(e.flags),
      timers: clone(e.timers),
      ents: clone(e.ents),
      players: clone(e.players),
      clock: e.clock,
      phase: e.phase,
    };
    e.cpId = id;
    if (announce) {
      notify('Чекпоинт: контур и груз сохранены', 4);
      playSfx('ok');
    }
  };

  const restoreFromCheckpoint = () => {
    const e = engineRef.current;
    if (e.checkpoint) {
      e.flags = clone(e.checkpoint.flags);
      e.timers = clone(e.checkpoint.timers);
      e.ents = clone(e.checkpoint.ents);
      e.players = clone(e.checkpoint.players);
      e.clock = e.checkpoint.clock;
      e.players.forEach((p) => {
        p.vx = p.x;
        p.vy = p.y;
        p.cool = 0;
        p.ride = null;
      });
    } else {
      loadLevel(e.index, e.phase, true);
    }
    e.doorStates.clear();
    e.keys.clear();
    e.held.fill(false);
    e.winHold = 0;
    e.deathLeft = 0;
    e.mode = 'play';
    setCurrentMode('play');
    updateAudioGain();
    updateHUDText();
  };

  const loadLevel = (idx: number, p = 0, restoring = false) => {
    const e = engineRef.current;
    e.index = idx;
    e.phase = p;
    setLevelIndex(idx);
    setPhaseIndex(p);
    const parent = ALL_LEVELS[idx];
    e.L = parent.phases ? parent.phases[p] : parent;
    e.ents = clone(e.L.entities);

    // Initialize drones with progress & direction
    for (const ent of e.ents) {
      if (ent.kind === 'drone') {
        ent.dir = 1;
        ent.progress = 0;
        ent.x = ent.a?.x ?? ent.x;
        ent.y = ent.a?.y ?? ent.y;
      }
    }

    e.players = e.L.starts.map(([x, y], n) => ({
      x,
      y,
      vx: x,
      vy: y,
      role: n ? 'water' : 'fire',
      face: { x: 0, y: -1 },
      cool: 0,
      ride: null,
      carrying: null,
    }));

    e.flags = {};
    e.timers = {};
    e.clock = 0;
    e.winHold = 0;
    e.deathLeft = 0;
    e.floor = new Set();
    e.walls = new Set();
    e.pit = new Set();

    rectSet(e.floor, e.L.rooms);
    if (e.L.walls) rectSet(e.walls, e.L.walls);
    if (e.L.holes) rectSet(e.pit, e.L.holes);
    for (const k of e.walls) e.floor.delete(k);

    e.doorStates.clear();
    e.keys.clear();
    e.held.fill(false);
    e.checkpoint = null;
    e.cpId = '';
    setHintIndex(0);
    e.mode = 'play';
    setCurrentMode('play');

    if (!restoring) e.levelTime = 0;
    if (!e.testing) {
      saveRef.current.last = idx;
      saveRef.current.phase = p;
      persist();
    }

    snapshotCheckpoint(
      parent.phases ? `Фаза ${p + 1}` : 'Старт сектора',
      false
    );
    updateHUDText();
    updateAudioGain();

    if (!e.testing) {
      const tipKey = `${idx}:${p}`;
      if (!e.seenTips.has(tipKey)) {
        e.seenTips.add(tipKey);
        notify(e.L.tip, 7);
      } else {
        notify(`Контур готов. ${e.L.goal}`, 3);
      }
    }
  };

  const completeLevel = () => {
    const e = engineRef.current;
    e.keys.clear();
    e.held.fill(false);
    playSfx('win');

    if (ALL_LEVELS[e.index].phases && e.phase < 2) {
      loadLevel(e.index, e.phase + 1, true);
      notify(`Фаза завершена. Чекпоинт ${e.phase + 1} / 3`, 6);
      return;
    }

    e.mode = 'won';
    setCurrentMode('won');

    if (!e.testing) {
      if (e.index < 13) {
        saveRef.current.unlocked = Math.max(
          saveRef.current.unlocked,
          Math.min(12, e.index + 1)
        );
      } else {
        saveRef.current.unlockedVol2 = Math.max(
          saveRef.current.unlockedVol2,
          e.index - 13 + 1
        );
      }
      saveRef.current.last = Math.min(ALL_LEVELS.length - 1, e.index + 1);
      saveRef.current.phase = 0;
      if (e.index === ALL_LEVELS.length - 1) saveRef.current.finished = true;
      persist();
    }
    updateAudioGain();
  };

  const getContextText = (n: number) => {
    const e = engineRef.current;
    const p = e.players[n];
    if (!p) return '';
    if (p.ride) return 'Платформа в пути · движение заблокировано';
    const target = getNearestTarget(n);
    const key = n ? 'Enter' : 'F';
    if (!target) {
      return p.carrying
        ? `${key}: положить куб`
        : 'Светлый настил безопасен · чёрный край ограждён';
    }
    if (target.kind === 'drop') return `${key}: положить ${target.id} под собой`;
    if (target.kind === 'box') return `${key}: поднять куб ${target.id}`;
    if (target.kind === 'ferry') {
      return `${key}: ехать / вызвать ${target.id}${
        p.carrying ? ' с грузом' : ''
      }${checkReq(target.req) ? '' : ` · нужно ${target.req}`}`;
    }
    if (target.kind === 'sync') return `Держите ${key} · партнёр удерживает свою S`;
    if (target.role && target.role !== p.role) {
      return `Здесь нужен ${target.role === 'fire' ? 'Огонь' : 'Вода'}`;
    }
    return `${key}: ${
      target.label ||
      (target.kind === 'barrier'
        ? target.type === 'ice'
          ? 'растопить лёд'
          : 'сжечь лианы'
        : `активировать ${target.id}`)
    }${target.req && !checkReq(target.req) ? ` · нужно ${target.req}` : ''}`;
  };

  const updateHUDText = () => {
    const e = engineRef.current;
    const parent = ALL_LEVELS[e.index];
    if (!parent || e.players.length < 2) return;
    const isVol2 = (parent.volume || 1) === 2 || e.index >= 13;
    const secNum = isVol2 ? e.index - 13 + 1 : e.index + 1;
    const volPrefix = isVol2 ? 'ТОМ 2 / СЕКТОР' : 'СЕКТОР';

    const labels: string[] = [];
    const seen = new Set<string>();
    for (const item of e.ents) {
      if (
        ['switch', 'plate', 'socket', 'sync', 'barrier'].includes(item.kind) &&
        !seen.has(item.id)
      ) {
        seen.add(item.id);
        const time =
          e.timers[item.id] > e.clock
            ? ` ${Math.ceil(e.timers[item.id] - e.clock)}с`
            : '';
        labels.push(`${item.id} ${getSignal(item.id) ? '●' : '○'}${time}`);
      }
      if (item.kind === 'drone' && !seen.has(item.id)) {
        seen.add(item.id);
        const isOff = item.off && checkReq(item.off);
        labels.push(`${item.id} ${isOff ? '○' : '▲'}`);
      }
      if (item.kind === 'core') {
        labels.push(
          `ЯДРО ${Math.min(
            100,
            Math.floor(((item.charge || 0) / (item.duration || 1)) * 100)
          )}%`
        );
      }
    }

    setHudHeader({
      chapter:
        `${volPrefix} ${String(secNum).padStart(2, '0')}` +
        (parent.phases ? ` · ФАЗА ${e.phase + 1} / 3` : ''),
      title: parent.title + (parent.phases ? ` / ${e.L.title}` : ''),
      goal: e.L.goal,
      progress: labels.join('  '),
      tip: e.L.tip,
      fireContext: getContextText(0),
      waterContext: getContextText(1),
    });
  };

  // Main Simulation Step
  const updateSim = (dt: number) => {
    const e = engineRef.current;
    if (e.mode === 'dead') {
      e.deathLeft -= dt;
      if (e.deathLeft <= 0) restoreFromCheckpoint();
      return;
    }
    if (e.mode !== 'play') return;

    e.clock += dt;
    e.levelTime += dt;
    if (e.noticeLeft > 0) {
      e.noticeLeft -= dt;
      if (e.noticeLeft <= 0) setShowNotice(false);
    }

    // Player inputs
    for (let n = 0; n < 2; n++) {
      const p = e.players[n];
      p.cool = Math.max(0, p.cool - dt);
      if (!p.ride && p.cool <= 0) {
        const dirs = n
          ? ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']
          : ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
        const active = [...e.keys].reverse().find((k) => dirs.includes(k));
        if (active) {
          const k = dirs.indexOf(active);
          const v = [
            [0, -1],
            [-1, 0],
            [0, 1],
            [1, 0],
          ][k];
          movePlayer(n, v[0], v[1]);
          p.cool = 0.155;
        }
      }
      if (e.mode !== 'play') return;
    }

    // Entities simulation
    for (const item of e.ents) {
      // Ferry lift
      if (item.kind === 'ferry' && item.trip) {
        const t = item.trip;
        t.t = Math.min(t.duration, t.t + dt);
        const v = t.t / t.duration;
        const k = v * v * (3 - 2 * v);
        item.x = t.from.x + (t.to.x - t.from.x) * k;
        item.y = t.from.y + (t.to.y - t.from.y) * k;
        for (const n of t.riders) {
          const p = e.players[n];
          p.vx = item.x;
          p.vy = item.y;
        }
        if (t.t >= t.duration) {
          item.x = t.to.x;
          item.y = t.to.y;
          item.side = at(item, item.a!) ? 0 : 1;
          for (const n of t.riders) {
            const p = e.players[n];
            p.x = item.x;
            p.y = item.y;
            p.ride = null;
            p.cool = 0.2;
            if (p.carrying) {
              const b = e.ents.find(
                (bx) => bx.kind === 'box' && bx.id === p.carrying
              );
              if (b) {
                b.x = p.x;
                b.y = p.y;
              }
            }
          }
          item.trip = null;
        }
      }

      // Drone patrol logic (Volume 2)
      if (item.kind === 'drone') {
        const isOff = item.off && checkReq(item.off);
        if (!isOff && item.a && item.b) {
          const speed = (item.speed || 1.4) * (saveRef.current.droneSpeedMultiplier || 1.0);
          const totalDist = Math.hypot(item.b.x - item.a.x, item.b.y - item.a.y);
          if (totalDist > 0) {
            item.progress = (item.progress ?? 0) + (dt * speed * (item.dir ?? 1)) / totalDist;
            if (item.progress >= 1) {
              item.progress = 1;
              item.dir = -1;
            } else if (item.progress <= 0) {
              item.progress = 0;
              item.dir = 1;
            }
            item.x = item.a.x + (item.b.x - item.a.x) * item.progress;
            item.y = item.a.y + (item.b.y - item.a.y) * item.progress;
          }

          // Check lethal collision with players
          for (const p of e.players) {
            const dPlayer = Math.hypot(p.x - item.x, p.y - item.y);
            if (dPlayer < 0.85) {
              die('Столкновение с патрульным дроном');
              return;
            }
          }
        }
      }

      // Sync panels
      if (item.kind === 'sync' && !e.flags[item.id]) {
        const pair = e.ents.filter(
          (q) => q.kind === 'sync' && q.id === item.id
        );
        if (pair[0] === item && pair.length === 2) {
          const ok = pair.every((q) =>
            e.players.some(
              (p, n) =>
                p.role === q.role &&
                at(p, q) &&
                !p.carrying &&
                !p.ride &&
                (e.held[n] || e.keys.has(n ? 'Enter' : 'KeyF'))
            )
          );
          item.charge = ok
            ? (item.charge || 0) + dt
            : Math.max(0, (item.charge || 0) - dt * 2);
          if (item.charge >= 1.2) {
            e.flags[item.id] = true;
            playSfx('ok');
            notify(`Синхронизация ${item.id} зафиксирована`, 3);
          }
        }
      }

      // Core
      if (item.kind === 'core' && !e.flags['core:' + item.id]) {
        const ok = checkReq(item.req) && e.players.every((p) => dist(p, item) <= 1 && !p.ride);
        item.charge = ok
          ? (item.charge || 0) + dt
          : Math.max(0, (item.charge || 0) - dt);
        if (item.charge >= (item.duration || 1)) {
          e.flags['core:' + item.id] = true;
          playSfx('ok');
        }
      }

      // Fragments
      const fragId = `${e.index}:${e.phase}:${item.x}:${item.y}`;
      if (
        item.kind === 'fragment' &&
        !item.done &&
        saveRef.current.fragments.includes(fragId)
      ) {
        item.done = true;
      }
      if (
        item.kind === 'fragment' &&
        !item.done &&
        checkReq(item.req) &&
        e.players.some((p) => at(p, item) && !p.ride)
      ) {
        item.done = true;
        if (!saveRef.current.fragments.includes(fragId) && !e.testing) {
          saveRef.current.fragments.push(fragId);
          persist();
        }
        notify('Фрагмент кондуита найден. На выход он не влияет.', 4);
        playSfx('ok');
      }

      // Conveyor logic (Volume 2)
      if (item.kind === 'conveyor') {
        const isOff = item.off && checkReq(item.off);
        if (!isOff && (item.dx || item.dy)) {
          item.timer = (item.timer || 0) + dt;
          if (item.timer >= 0.3) {
            item.timer = 0;
            // Push players on this conveyor
            for (let n = 0; n < 2; n++) {
              const p = e.players[n];
              if (!p.ride && isInside(item, p.x, p.y)) {
                movePlayer(n, item.dx || 0, item.dy || 0);
              }
            }
            // Push uncarried boxes on this conveyor
            for (const b of e.ents) {
              if (b.kind === 'box' && b.carrier === null && isInside(item, b.x, b.y)) {
                const targetX = b.x + (item.dx || 0);
                const targetY = b.y + (item.dy || 0);
                if (
                  e.floor.has(cell(targetX, targetY)) &&
                  !e.ents.some(
                    (other) =>
                      other.kind === 'box' &&
                      other.carrier === null &&
                      other.x === targetX &&
                      other.y === targetY
                  )
                ) {
                  b.x = targetX;
                  b.y = targetY;
                }
              }
            }
          }
        }
      }

      // Checkpoint
      if (
        item.kind === 'checkpoint' &&
        !item.done &&
        checkReq(item.req) &&
        e.players.every((p) => dist(p, item) <= (item.radius || 2) && !p.ride) &&
        !e.ents.some((q) => q.trip)
      ) {
        item.done = true;
        snapshotCheckpoint(item.id);
      }

      // Gate sound
      if (item.kind === 'gate') {
        const open = item.role ? false : checkReq(item.req);
        if (e.doorStates.has(item) && e.doorStates.get(item) !== open) {
          playSfx('open');
        }
        e.doorStates.set(item, open);
      }
    }

    // Player position interpolation and danger checks
    for (const p of e.players) {
      if (!p.ride) {
        const k = 1 - Math.exp(-dt * 23);
        p.vx += (p.x - p.vx) * k;
        p.vy += (p.y - p.vy) * k;
        const reason = getDangerReason(p.x, p.y, p);
        if (reason) {
          die(reason);
          return;
        }
      }
    }

    // Win check
    const exits = e.ents.filter((item) => item.kind === 'exit');
    const won = e.L.win.startsWith('core:')
      ? !!e.flags[e.L.win]
      : checkReq(e.L.win) &&
        e.players.every((p) =>
          exits.some((exitItem) => exitItem.role === p.role && at(p, exitItem))
        ) &&
        !e.players.some((p) => p.ride);

    e.winHold = won ? e.winHold + dt : 0;
    if (e.winHold >= 0.65) {
      completeLevel();
    }
  };

  // Music Step
  const stepMusic = () => {
    const a = audioRef.current;
    if (!a.ctx || a.ctx.state !== 'running') return;
    if (!saveRef.current.music || engineRef.current.mode !== 'play') {
      a.next = a.ctx.currentTime + 0.08;
      return;
    }
    if (a.next < a.ctx.currentTime) a.next = a.ctx.currentTime + 0.03;
    let scheduled = 0;
    while (a.next < a.ctx.currentTime + 0.13 && scheduled++ < 4) {
      const t = a.next;
      const s = a.step % 64;
      const beat = s % 16;
      const root = [55, 65.406, 49, 58.27][Math.floor(s / 16)];

      if (beat % 4 === 0) playTone(130, t, 0.18, 'sine', 0.65, a.musicBus!, 42);
      if (beat === 4 || beat === 12) {
        playTone(180, t, 0.1, 'triangle', 0.11, a.musicBus!, 95);
      }
      if ([0, 3, 6, 8, 11, 14].includes(beat)) {
        playTone(root * (beat % 3 === 0 ? 1 : 2), t, 0.17, 'triangle', 0.3, a.musicBus!);
      }
      if (s >= 16 && beat % 2 === 1) {
        const n = [0, 7, 12, 10, 7, 3, 12, 15][Math.floor(beat / 2)];
        playTone(root * 4 * Math.pow(2, n / 12), t, 0.22, 'sine', 0.09, a.musicBus!);
      }
      a.step++;
      a.next += 60 / 126 / 4;
    }
  };

  // Resize Canvas
  const handleResize = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const d = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = Math.round(w * d);
    canvas.height = Math.round(h * d);

    const ctx = canvas.getContext('2d');
    if (ctx) ctx.setTransform(d, 0, 0, d, 0, 0);

    const bottom = 90;
    const top = w < 640 ? 140 : 110;
    let s = Math.min((w - 36) / 25, (h - top - bottom - 12) / 17);
    s = Math.max(8, s);
    const ox = (w - 25 * s) / 2;
    const oy = top + (h - top - bottom - 17 * s) / 2;

    engineRef.current.view = { w, h, s, x: ox, y: oy };
  };

  // Canvas Drawing
  const renderFrame = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { w, h, s, x: ox, y: oy } = engineRef.current.view;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#080e19';
    ctx.fillRect(0, 0, w, h);

    // Starfield decoration
    for (let i = 0; i < 75; i++) {
      const sx = (i * 197 + 31) % Math.max(1, w);
      const sy = (i * 113 + 71) % Math.max(1, h);
      ctx.fillStyle = i % 4 ? '#243445' : '#415365';
      ctx.fillRect(sx, sy, 1, 1);
    }

    const e = engineRef.current;
    if (!e.L) return;

    ctx.save();
    ctx.translate(ox, oy);
    const X = (px: number) => (px + 0.5) * s;
    const Y = (py: number) => (py + 0.5) * s;

    // Draw Floor Tiles
    for (const k of e.floor) {
      const [fx, fy] = k.split(',').map(Number);
      if (e.pit.has(k)) continue;
      const px = fx * s;
      const py = fy * s;

      ctx.fillStyle = '#07111b';
      ctx.beginPath();
      ctx.roundRect(px + 1, py + 3, s - 2, s - 2, 2);
      ctx.fill();

      ctx.fillStyle = (fx + fy) % 2 ? '#1b2b3b' : '#1d2e3e';
      ctx.beginPath();
      ctx.roundRect(px + 1, py + 1, s - 2, s - 3, 2);
      ctx.fill();

      // Border outline
      const pDirs = [
        [fx - 1, fy],
        [fx + 1, fy],
        [fx, fy - 1],
        [fx, fy + 1],
      ];
      ctx.strokeStyle = '#536b7e';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      if (!e.floor.has(cell(pDirs[0][0], pDirs[0][1]))) {
        ctx.moveTo(px + 1, py + 1);
        ctx.lineTo(px + 1, py + s - 2);
      }
      if (!e.floor.has(cell(pDirs[1][0], pDirs[1][1]))) {
        ctx.moveTo(px + s - 2, py + 1);
        ctx.lineTo(px + s - 2, py + s - 2);
      }
      if (!e.floor.has(cell(pDirs[2][0], pDirs[2][1]))) {
        ctx.moveTo(px + 1, py + 1);
        ctx.lineTo(px + s - 2, py + 1);
      }
      if (!e.floor.has(cell(pDirs[3][0], pDirs[3][1]))) {
        ctx.moveTo(px + 1, py + s - 2);
        ctx.lineTo(px + s - 2, py + s - 2);
      }
      ctx.stroke();
    }

    // Draw Pits
    for (const k of e.pit) {
      const [fx, fy] = k.split(',').map(Number);
      ctx.fillStyle = '#040811';
      ctx.strokeStyle = '#455064';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.rect(fx * s + 1, fy * s + 1, s - 2, s - 2);
      ctx.fill();
      ctx.stroke();
    }

    // Circuit wires
    for (const item of e.ents) {
      if (['gate', 'hazard', 'drone'].includes(item.kind) && !item.role) {
        const ids = (item.req || item.off || '').split(/[&|]/);
        for (const id of ids) {
          const a = e.ents.find(
            (q) =>
              q.id === id &&
              ['plate', 'switch', 'sync', 'socket'].includes(q.kind)
          );
          if (a) {
            const wireColor = getSignal(id) ? '#75928a60' : '#596f8540';
            ctx.strokeStyle = wireColor;
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 5]);
            ctx.beginPath();
            ctx.moveTo(X(a.x), Y(a.y));
            ctx.lineTo(X(item.x), Y(a.y));
            ctx.lineTo(X(item.x), Y(item.y));
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }
      }
    }

    // Draw Entities
    for (const item of e.ents) {
      const x = X(item.x);
      const y = Y(item.y);
      const u = s * 0.36;
      const color = item.role ? C[item.role] : C.both;
      const on = getSignal(item.id);

      ctx.save();

      // Hazards
      if (item.kind === 'hazard') {
        const off = item.off && checkReq(item.off);
        const col = off
          ? C.ok
          : item.type === 'laser'
          ? C.danger
          : item.type === 'heat'
          ? C.fire
          : C.water;
        for (let j = 0; j < (item.h || 1); j++) {
          for (let i = 0; i < (item.w || 1); i++) {
            const px = (item.x + i) * s;
            const py = (item.y + j) * s;
            ctx.fillStyle = off
              ? '#253d40'
              : item.type === 'heat'
              ? '#543525'
              : item.type === 'water'
              ? '#183e58'
              : '#422534';
            ctx.strokeStyle = col;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(px + 2, py + 2, s - 4, s - 4, 2);
            ctx.fill();
            ctx.stroke();

            if (item.type === 'laser') {
              ctx.strokeStyle = col;
              ctx.lineWidth = off ? 1 : 3;
              ctx.beginPath();
              ctx.moveTo(px + 4, py + 5);
              ctx.lineTo(px + s - 4, py + s - 5);
              ctx.stroke();
            }
          }
        }
      }

      // Pulse Laser (Volume 2)
      if (item.kind === 'pulseLaser') {
        const isOff = item.off && checkReq(item.off);
        const period = item.period || 3.5;
        const duty = item.duty || 0.45;
        const activeDuration = period * duty;
        const cycle = (e.clock + (item.timeOffset || 0)) % period;
        const isActive = !isOff && (cycle < activeDuration);
        const isWarning = !isOff && !isActive && (cycle >= period - 0.55);

        for (let j = 0; j < (item.h || 1); j++) {
          for (let i = 0; i < (item.w || 1); i++) {
            const px = (item.x + i) * s;
            const py = (item.y + j) * s;

            // Background cell
            ctx.fillStyle = isOff ? '#182430' : isActive ? '#4a1524' : isWarning ? '#3d2e15' : '#14202d';
            ctx.strokeStyle = isOff ? '#354859' : isActive ? C.danger : isWarning ? '#f59e0b' : '#3c5366';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(px + 2, py + 2, s - 4, s - 4, 2);
            ctx.fill();
            ctx.stroke();

            if (isActive) {
              // High energy pulse blast
              ctx.strokeStyle = '#ffffff';
              ctx.lineWidth = 2.5;
              ctx.beginPath();
              ctx.moveTo(px + 3, py + s / 2);
              ctx.lineTo(px + s - 3, py + s / 2);
              ctx.stroke();

              ctx.strokeStyle = C.danger;
              ctx.lineWidth = 6;
              ctx.beginPath();
              ctx.moveTo(px + 3, py + s / 2);
              ctx.lineTo(px + s - 3, py + s / 2);
              ctx.stroke();
            } else if (isWarning) {
              // Warning flash dots
              const flash = Math.sin(e.clock * 25) > 0;
              if (flash) {
                ctx.fillStyle = '#fbbf24';
                ctx.beginPath();
                ctx.arc(px + s / 2, py + s / 2, 4, 0, Math.PI * 2);
                ctx.fill();
              }
            } else {
              // Guide line
              ctx.strokeStyle = '#43586b55';
              ctx.lineWidth = 1;
              ctx.setLineDash([2, 3]);
              ctx.beginPath();
              ctx.moveTo(px + 4, py + s / 2);
              ctx.lineTo(px + s - 4, py + s / 2);
              ctx.stroke();
              ctx.setLineDash([]);
            }
          }
        }
      }

      // Conveyor belt (Volume 2)
      if (item.kind === 'conveyor') {
        const isOff = item.off && checkReq(item.off);
        const col = isOff ? '#3d5264' : '#38bdf8';
        for (let j = 0; j < (item.h || 1); j++) {
          for (let i = 0; i < (item.w || 1); i++) {
            const px = (item.x + i) * s;
            const py = (item.y + j) * s;

            ctx.fillStyle = isOff ? '#16222e' : '#0c2438';
            ctx.strokeStyle = col;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(px + 1, py + 1, s - 2, s - 2, 2);
            ctx.fill();
            ctx.stroke();

            // Animated directional chevron arrow
            const offset = isOff ? 0 : (e.clock * 2) % 1;
            const cx = px + s / 2 + (item.dx || 0) * (offset - 0.5) * (s * 0.4);
            const cy = py + s / 2 + (item.dy || 0) * (offset - 0.5) * (s * 0.4);

            ctx.strokeStyle = col;
            ctx.lineWidth = 2;
            ctx.beginPath();
            if ((item.dx || 0) > 0) {
              ctx.moveTo(cx - 3, cy - 4);
              ctx.lineTo(cx + 3, cy);
              ctx.lineTo(cx - 3, cy + 4);
            } else if ((item.dx || 0) < 0) {
              ctx.moveTo(cx + 3, cy - 4);
              ctx.lineTo(cx - 3, cy);
              ctx.lineTo(cx + 3, cy + 4);
            } else if ((item.dy || 0) > 0) {
              ctx.moveTo(cx - 4, cy - 3);
              ctx.lineTo(cx, cy + 3);
              ctx.lineTo(cx + 4, cy - 3);
            } else {
              ctx.moveTo(cx - 4, cy + 3);
              ctx.lineTo(cx, cy - 3);
              ctx.lineTo(cx + 4, cy + 3);
            }
            ctx.stroke();
          }
        }
      }

      // Drone (Volume 2)
      if (item.kind === 'drone') {
        const isOff = item.off && checkReq(item.off);
        const droneColor = isOff ? '#637b8b' : C.danger;
        const bob = isOff ? 0 : Math.sin(e.clock * 5) * (s * 0.06);

        // Patrol rail track
        if (item.a && item.b) {
          ctx.strokeStyle = '#43586b40';
          ctx.lineWidth = 2;
          ctx.setLineDash([2, 4]);
          ctx.beginPath();
          ctx.moveTo(X(item.a.x), Y(item.a.y));
          ctx.lineTo(X(item.b.x), Y(item.b.y));
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Active sensor cone
        if (!isOff) {
          ctx.fillStyle = 'rgba(255, 96, 116, 0.12)';
          ctx.beginPath();
          ctx.arc(x, y + bob, s * 0.75, 0, Math.PI * 2);
          ctx.fill();
        }

        // Drone Chassis
        ctx.fillStyle = isOff ? '#1c2834' : '#2d1822';
        ctx.strokeStyle = droneColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y + bob, s * 0.34, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Glowing center core
        ctx.fillStyle = isOff ? '#4b6172' : C.danger;
        ctx.beginPath();
        ctx.arc(x, y + bob, s * 0.14, 0, Math.PI * 2);
        ctx.fill();

        // Label
        ctx.fillStyle = isOff ? '#8295a5' : '#ffffff';
        ctx.font = `700 ${Math.max(10, s * 0.3)}px system-ui`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(item.id, x, y + bob - s * 0.44);
      }

      // Gates
      if (item.kind === 'gate') {
        const open = !item.role && checkReq(item.req);
        const col = item.role ? color : open ? C.ok : '#e1b98a';
        ctx.fillStyle = open
          ? '#213d3f66'
          : item.role
          ? '#243846dd'
          : '#4a4140';
        ctx.strokeStyle = col;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(
          item.x * s + 3,
          item.y * s + 3,
          (item.w || 1) * s - 6,
          (item.h || 1) * s - 6,
          3
        );
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = col;
        ctx.font = `600 ${Math.max(10, s * 0.3)}px system-ui`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(
          item.id,
          x + ((item.w || 1) - 1) * s * 0.5,
          y + ((item.h || 1) - 1) * s * 0.5
        );
      }

      // Barrier (Ice/Vine)
      if (item.kind === 'barrier' && !e.flags[item.id]) {
        ctx.fillStyle = item.type === 'ice' ? '#286479' : '#4c3d31';
        ctx.strokeStyle = item.type === 'ice' ? C.water : C.fire;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(x - u, y - u, u * 2, u * 2, 3);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#fff';
        ctx.font = `600 ${s * 0.36}px system-ui`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(item.id, x, y);
      }

      // Plate
      if (item.kind === 'plate') {
        ctx.fillStyle = '#101c29';
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, u + 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = on ? '#546754' : '#344156';
        ctx.strokeStyle = on ? C.ok : color;
        ctx.beginPath();
        ctx.roundRect(x - u * 0.7, y - u * 0.7, u * 1.4, u * 1.4, 3);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = on ? C.ok : color;
        ctx.font = `600 ${Math.max(10, s * 0.33)}px system-ui`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(item.id, x, y);
      }

      // Socket
      if (item.kind === 'socket') {
        ctx.fillStyle = on ? '#354e43' : '#27334b';
        ctx.strokeStyle = on ? C.ok : color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(x - u - 2, y - u - 2, u * 2 + 4, u * 2 + 4, 4);
        ctx.fill();
        ctx.stroke();

        ctx.strokeStyle = color;
        ctx.strokeRect(x - u * 0.55, y - u * 0.55, u * 1.1, u * 1.1);

        ctx.fillStyle = on ? C.ok : color;
        ctx.font = `600 ${Math.max(10, s * 0.35)}px system-ui`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(item.id, x, y);
      }

      // Switch
      if (item.kind === 'switch') {
        ctx.fillStyle = on ? '#34484e' : '#182635';
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(x - u, y - u, u * 2, u * 2, 4);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = on ? C.ok : color;
        ctx.fillRect(x - u * 0.7, y - u * 0.65, u * 1.4, u * 0.25);

        ctx.fillStyle = color;
        ctx.font = `600 ${Math.max(11, s * 0.37)}px system-ui`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(item.id, x, y + u * 0.25);

        if (item.timer && e.timers[item.id] > e.clock) {
          ctx.strokeStyle = C.ok;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(
            x,
            y,
            u + 5,
            -Math.PI / 2,
            -Math.PI / 2 +
              ((e.timers[item.id] - e.clock) / item.timer) * Math.PI * 2
          );
          ctx.stroke();
        }
      }

      // Sync
      if (item.kind === 'sync') {
        ctx.fillStyle = on ? '#394650' : '#2b2841';
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, u + 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = color;
        ctx.font = `600 ${s * 0.4}px system-ui`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(item.id, x, y);

        const first = e.ents.find(
          (q) => q.kind === 'sync' && q.id === item.id
        );
        if (first?.charge && !on) {
          ctx.beginPath();
          ctx.arc(
            x,
            y,
            u + 6,
            -Math.PI / 2,
            -Math.PI / 2 + (Math.PI * 2 * first.charge) / 1.2
          );
          ctx.strokeStyle = C.ok;
          ctx.lineWidth = 3;
          ctx.stroke();
        }
      }

      // Ferry
      if (item.kind === 'ferry') {
        ctx.strokeStyle = '#5b778b';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 6]);
        ctx.beginPath();
        ctx.moveTo(X(item.a!.x), Y(item.a!.y));
        ctx.lineTo(X(item.b!.x), Y(item.b!.y));
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = checkReq(item.req) ? '#435f69' : '#334452';
        ctx.strokeStyle = checkReq(item.req) ? C.water : '#7b8ca1';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(x - s * 0.44, y - s * 0.44, s * 0.88, s * 0.88, 4);
        ctx.fill();
        ctx.stroke();
      }

      // Exit
      if (item.kind === 'exit') {
        const canWin = checkReq(e.L.win);
        ctx.fillStyle = canWin ? '#25433c' : '#1d2936';
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(x - u - 2, y - u - 2, u * 2 + 4, u * 2 + 4, 4);
        ctx.fill();
        ctx.stroke();

        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - u * 0.6, y);
        ctx.lineTo(x + u * 0.6, y);
        ctx.lineTo(x + u * 0.1, y - u * 0.5);
        ctx.stroke();
      }

      // Fragment
      if (item.kind === 'fragment' && !item.done) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = checkReq(item.req) ? '#e4f1ce' : '#586e68';
        ctx.strokeStyle = C.ok;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(-u * 0.45, -u * 0.45, u * 0.9, u * 0.9, 1);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      // Core
      if (item.kind === 'core') {
        ctx.fillStyle = '#222d43';
        ctx.strokeStyle = '#607b92';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, s * 0.66, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#4a376a';
        ctx.strokeStyle = C.both;
        ctx.beginPath();
        ctx.arc(x, y, s * 0.47, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        if (item.charge) {
          ctx.beginPath();
          ctx.arc(
            x,
            y,
            s * 0.7,
            -Math.PI / 2,
            -Math.PI / 2 +
              Math.PI * 2 * Math.min(1, item.charge / (item.duration || 1))
          );
          ctx.strokeStyle = C.ok;
          ctx.lineWidth = 4;
          ctx.stroke();
        }
      }

      ctx.restore();
    }

    // Boxes
    for (const b of e.ents) {
      if (b.kind === 'box' && b.carrier === null) {
        const bx = X(b.x);
        const by = Y(b.y);
        const r = s * 0.27;

        ctx.fillStyle = '#08111c';
        ctx.beginPath();
        ctx.roundRect(bx - r, by - r + 3, r * 2, r * 2, 3);
        ctx.fill();

        ctx.fillStyle = '#74598b';
        ctx.strokeStyle = C.both;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(bx - r, by - r, r * 2, r * 2, 3);
        ctx.fill();
        ctx.stroke();
      }
    }

    // Player action targeting indicators
    e.players.forEach((p, n) => {
      if (p.ride) return;
      const target = getNearestTarget(n);
      if (!target || target.kind === 'drop') return;
      const targetPos =
        target.kind === 'ferry'
          ? dist(p, target.a!) <= dist(p, target.b!)
            ? target.a!
            : target.b!
          : target;
      const tx = X(targetPos.x);
      const ty = Y(targetPos.y);
      const r = s * (n ? 0.46 : 0.42);
      const a = s * 0.14;
      const col = C[p.role];

      ctx.strokeStyle = col;
      ctx.lineWidth = 1.7;
      for (const [dx, dy] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ]) {
        ctx.beginPath();
        ctx.moveTo(tx + dx * (r - a), ty + dy * r);
        ctx.lineTo(tx + dx * r, ty + dy * r);
        ctx.lineTo(tx + dx * r, ty + dy * (r - a));
        ctx.stroke();
      }
    });

    // Players
    e.players.forEach((p, n) => {
      const overlap = dist(e.players[0], e.players[1]) === 0;
      const offset = overlap ? (n ? 1 : -1) * s * 0.15 : 0;
      const px = X(p.vx) + offset;
      const py = Y(p.vy);
      const r = s * 0.27;
      const col = C[p.role];

      // Shadow
      ctx.fillStyle = '#07101a99';
      ctx.beginPath();
      ctx.arc(px, py + s * 0.17, r * 1.1, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      ctx.shadowColor = col;
      ctx.shadowBlur = e.mode === 'dead' ? 0 : 10;
      if (n) {
        // Water droplet
        ctx.beginPath();
        ctx.moveTo(px, py - r * 1.3);
        ctx.bezierCurveTo(px + r * 1.5, py, px + r, py + r, px, py + r);
        ctx.bezierCurveTo(px - r, py + r, px - r * 1.5, py, px, py - r * 1.3);
        ctx.fillStyle = col;
        ctx.fill();
      } else {
        // Fire block
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.roundRect(px - r, py - r, r * 2, r * 2, 4);
        ctx.fill();
      }
      ctx.restore();

      // Eyes
      ctx.fillStyle = '#122b39';
      ctx.beginPath();
      ctx.arc(px - r * 0.27, py - r * 0.2, r * 0.16, 0, Math.PI * 2);
      ctx.arc(px + r * 0.35, py - r * 0.2, r * 0.16, 0, Math.PI * 2);
      ctx.fill();

      // Number badge
      ctx.fillStyle = col;
      ctx.font = `700 ${Math.max(10, s * 0.3)}px system-ui`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(n ? '2' : '1', px, py - r - s * 0.2);

      // Carrying crate
      if (p.carrying) {
        ctx.fillStyle = '#70558b';
        ctx.strokeStyle = C.both;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(px - r * 0.6, py - r - s * 0.45, r * 1.2, r * 1.2, 2);
        ctx.fill();
        ctx.stroke();
      }
    });

    ctx.restore();
  };

  // Main Loop
  useEffect(() => {
    let animId: number;
    let frames = 0;
    let fpsLast = performance.now();
    let hudTimer = 0;

    const loop = (t: number) => {
      const e = engineRef.current;
      const dt = Math.min(0.1, (t - e.lastTime) / 1000 || 0);
      e.lastTime = t;

      if (!e.manual) {
        e.accumulator += dt;
        let steps = 0;
        while (e.accumulator >= 1 / 60 && steps++ < 6) {
          updateSim(1 / 60);
          e.accumulator -= 1 / 60;
        }
      }

      hudTimer += dt;
      if (hudTimer > 0.1) {
        updateHUDText();
        hudTimer = 0;
      }

      renderFrame();
      stepMusic();

      frames++;
      if (t - fpsLast > 1000) {
        setFpsText(`${Math.round((frames * 1000) / (t - fpsLast))} fps`);
        frames = 0;
        fpsLast = t;
      }

      animId = requestAnimationFrame(loop);
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    animId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  // Keyboard Event Listeners
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.code;
      const eng = engineRef.current;

      const controlKeys = [
        'KeyW',
        'KeyA',
        'KeyS',
        'KeyD',
        'KeyF',
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
        'Enter',
        'KeyR',
        'Escape',
        'KeyH',
      ];

      if (controlKeys.includes(k)) {
        if (
          eng.mode === 'play' ||
          eng.mode === 'dead' ||
          ['Escape', 'KeyR', 'KeyH'].includes(k)
        ) {
          e.preventDefault();
        }
        if (e.repeat) return;

        initAudio();

        if (k === 'KeyR' && eng.L && eng.mode !== 'menu' && eng.mode !== 'select') {
          loadLevel(eng.index, 0);
          return;
        }
        if (k === 'Escape') {
          if (eng.mode === 'play') {
            eng.mode = 'pause';
            setCurrentMode('pause');
          } else if (['pause', 'help', 'select'].includes(eng.mode) && eng.L) {
            eng.mode = 'play';
            setCurrentMode('play');
          }
          return;
        }
        if (k === 'KeyH' && eng.mode === 'play') {
          eng.mode = 'help';
          setCurrentMode('help');
          return;
        }

        if (eng.mode === 'play') {
          eng.keys.add(k);
          if (k === 'KeyF') actPlayer(0);
          if (k === 'Enter') actPlayer(1);
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      engineRef.current.keys.delete(e.code);
    };

    const handleBlur = () => {
      const eng = engineRef.current;
      eng.keys.clear();
      eng.held.fill(false);
      if (eng.mode === 'play') {
        eng.mode = 'pause';
        setCurrentMode('pause');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  // Expose ConduitQA diagnostic test runner for automated tests & inspection
  useEffect(() => {
    (window as any).ConduitQA = {
      load: (idx: number, p = 0) => {
        engineRef.current.manual = true;
        engineRef.current.testing = true;
        loadLevel(idx, p);
      },
      step: (ms: number) => {
        const n = Math.min(18000, Math.max(1, Math.ceil((ms / 1000) * 60)));
        for (let i = 0; i < n; i++) updateSim(ms / 1000 / n);
        renderFrame();
      },
      walk: (n: number, x: number, y: number) => {
        const eng = engineRef.current;
        const p = eng.players[n];
        const queue: [number, number][] = [[p.x, p.y]];
        const prev = new Map<string, [number, number] | null>([[cell(p.x, p.y), null]]);
        let found = false;

        for (let i = 0; i < queue.length && i < 1500; i++) {
          const [a, b] = queue[i];
          if (a === x && b === y) {
            found = true;
            break;
          }
          for (const [dx, dy] of [
            [0, -1],
            [1, 0],
            [0, 1],
            [-1, 0],
          ]) {
            const nx = a + dx;
            const ny = b + dy;
            const k = cell(nx, ny);
            if (
              prev.has(k) ||
              isBlocked(nx, ny, { ...p, x: a, y: b }) ||
              getDangerReason(nx, ny, p)
            ) {
              continue;
            }
            prev.set(k, [a, b]);
            queue.push([nx, ny]);
          }
        }

        if (!found) throw new Error(`Нет пути: игрок ${n} [${p.x},${p.y}] → [${x},${y}]`);
        const route: [number, number][] = [];
        let curr: [number, number] | null = [x, y];
        while (curr) {
          route.push(curr);
          curr = prev.get(cell(curr[0], curr[1])) || null;
        }
        route.reverse();

        for (let i = 1; i < route.length; i++) {
          const [nx, ny] = route[i];
          if (!movePlayer(n, nx - p.x, ny - p.y)) throw new Error(`Шаг заблокирован [${nx},${ny}]`);
          (window as any).ConduitQA.step(170);
          if (eng.mode === 'dead') throw new Error(`Смерть на маршруте к [${nx},${ny}]`);
        }
        return route.length - 1;
      },
      sync: (id: string) => {
        const eng = engineRef.current;
        eng.held[0] = eng.held[1] = true;
        (window as any).ConduitQA.step(1400);
        eng.held[0] = eng.held[1] = false;
        if (!eng.flags[id]) throw new Error(`Синхронизация ${id} не состоялась`);
      },
      run: (idx: number, p = 0) => {
        (window as any).ConduitQA.load(idx, p);
        const eng = engineRef.current;
        const proof = eng.L.proof;
        if (!proof) return { result: 'NO_PROOF' };
        const initialPhase = eng.phase;
        let stepCount = 0;

        for (const action of proof) {
          stepCount++;
          if (action[0] === 'wait') {
            (window as any).ConduitQA.step(action[1] * 1000);
          } else if (action[0] === 'sync') {
            (window as any).ConduitQA.sync(action[1]);
          } else if (action[1] === 'act') {
            if (!actPlayer(action[0])) throw new Error(`Действие игрока ${action[0]} не выполнено`);
          } else {
            (window as any).ConduitQA.walk(action[0], action[1], action[2]);
            if (action[3] === 'act' && !actPlayer(action[0])) {
              throw new Error(`Действие после движения не выполнено`);
            }
          }
        }

        if (eng.mode !== 'won' && eng.phase === initialPhase) {
          throw new Error('Маршрут доказательства завершен, но победа не зафиксирована');
        }
        return {
          level: idx + 1,
          phase: p + 1,
          steps: stepCount,
          time: eng.clock,
          result: 'PASS',
        };
      },
      checkSpawns: () => {
        const r: any[] = [];
        for (let i = 0; i < ALL_LEVELS.length; i++) {
          const l = ALL_LEVELS[i];
          const phaseCount = l.phases?.length || 1;
          for (let p = 0; p < phaseCount; p++) {
            (window as any).ConduitQA.load(i, p);
            const eng = engineRef.current;
            if (
              eng.players.some(
                (q) => isBlocked(q.x, q.y, q) || getDangerReason(q.x, q.y, q)
              )
            ) {
              throw new Error(`Небезопасный старт уровня ${i + 1}`);
            }
            r.push([i + 1, p + 1, 'SAFE']);
          }
        }
        return r;
      },
    };

  }, []);

  return (
    <div className="relative w-screen h-screen overflow-hidden select-none bg-slate-950 text-slate-100 font-sans">
      {/* Canvas */}
      <canvas ref={canvasRef} className="fixed inset-0 w-full h-full block" />

      {/* Header bar */}
      <header className="fixed top-0 left-0 right-0 z-10 px-6 py-3 bg-[#080e19f2] border-b border-slate-800 flex items-center justify-between gap-4 h-20 backdrop-blur-sm">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <svg className="w-9 h-9" viewBox="0 0 48 48">
            <path
              d="M7 12h14l8 12-8 12H7l9-12z"
              fill="none"
              stroke="#ff9459"
              strokeWidth="3.5"
            />
            <path
              d="M41 12H27l-8 12 8 12h14l-9-12z"
              fill="none"
              stroke="#66d5ef"
              strokeWidth="3.5"
            />
          </svg>
          <div>
            <div className="text-[11px] font-mono tracking-widest text-slate-400">
              ЭХО КОНДУИТА
            </div>
            <div className="text-sm font-bold text-white flex items-center gap-2">
              <span>{hudHeader.title}</span>
              {engineRef.current.L?.volume === 2 && (
                <span className="text-[10px] font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/30 px-1.5 py-0.2 rounded">
                  ТОМ 2
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Central Chapter Title */}
        <div className="hidden sm:block text-center">
          <div className="text-[10px] font-mono tracking-wider text-slate-400 uppercase">
            {hudHeader.chapter}
          </div>
          <div className="text-xs text-emerald-300 font-mono tracking-wide">
            {hudHeader.progress}
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          {/* Drone speed multiplier toggle */}
          <button
            onClick={() => {
              const next = droneSpeed === 1.0 ? 1.3 : droneSpeed === 1.3 ? 0.8 : 1.0;
              saveRef.current.droneSpeedMultiplier = next;
              setDroneSpeed(next);
              persist();
              notify(
                `Скорость дронов: ${
                  next === 0.8
                    ? '0.8x (Осторожно)'
                    : next === 1.3
                    ? '1.3x (Экстрим)'
                    : '1.0x (Стандарт)'
                }`,
                2
              );
            }}
            className="p-2 rounded bg-slate-900 border border-slate-700 hover:bg-slate-800 text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Скорость патрульных дронов: 0.8x / 1.0x / 1.3x"
          >
            <span className="font-mono text-amber-400 font-bold text-[11px]">
              {droneSpeed === 0.8 ? '0.8x' : droneSpeed === 1.3 ? '1.3x' : '1.0x'}
            </span>
            <span className="hidden lg:inline text-slate-300">Дроны</span>
          </button>

          {/* Audio controls */}
          <button
            onClick={() => {
              initAudio();
              const next = !isMusicOn;
              setIsMusicOn(next);
              saveRef.current.music = next;
              updateAudioGain();
              persist();
            }}
            className="p-2 rounded bg-slate-900 border border-slate-700 hover:bg-slate-800 text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Музыка"
          >
            {isMusicOn ? (
              <Volume2 className="w-3.5 h-3.5 text-sky-400" />
            ) : (
              <VolumeX className="w-3.5 h-3.5 text-slate-500" />
            )}
            <span className="hidden md:inline">Музыка</span>
          </button>

          <button
            onClick={() => {
              if (currentMode === 'play') {
                engineRef.current.mode = 'pause';
                setCurrentMode('pause');
              } else if (currentMode === 'pause') {
                engineRef.current.mode = 'play';
                setCurrentMode('play');
              } else {
                setCurrentMode('menu');
              }
            }}
            className="px-3 py-1.5 rounded bg-slate-900 border border-slate-700 hover:bg-slate-800 text-xs font-medium text-slate-200 transition-colors cursor-pointer"
          >
            {currentMode === 'play' ? 'Пауза · Esc' : 'Меню'}
          </button>
        </div>
      </header>

      {/* Goal & Progress Display */}
      {currentMode === 'play' && (
        <div className="fixed top-24 left-6 right-6 z-10 flex justify-between items-start pointer-events-none text-xs">
          <div className="bg-slate-950/80 border border-slate-800/80 px-3 py-1.5 rounded-lg text-slate-300 shadow">
            {hudHeader.goal}
          </div>
          <div className="sm:hidden font-mono text-emerald-400 bg-slate-950/80 border border-slate-800/80 px-2 py-1 rounded">
            {hudHeader.progress}
          </div>
        </div>
      )}

      {/* Notice Banner */}
      <div
        className={`fixed top-36 left-1/2 -translate-x-1/2 z-20 max-w-[85vw] bg-slate-900/95 border border-slate-700/80 rounded-lg px-4 py-2 text-xs font-medium text-slate-200 shadow-xl pointer-events-none transition-opacity duration-200 ${
          showNotice ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {hudNotice}
      </div>

      {/* Footer bar */}
      <footer className="fixed bottom-0 left-0 right-0 z-10 bg-[#0b1420f5] border-t border-slate-800 px-6 py-2.5 grid grid-cols-1 md:grid-cols-3 gap-2 text-xs text-slate-300">
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <span className="font-bold text-[#ff9459] flex items-center gap-1">
              <Flame className="w-3.5 h-3.5" /> 01 ОГОНЬ:
            </span>
            <span className="text-slate-400">
              <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> · <kbd>F</kbd> действие
            </span>
          </div>
          <div className="text-[11px] text-slate-400 truncate mt-0.5">
            {hudHeader.fireContext}
          </div>
        </div>

        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <span className="font-bold text-[#66d5ef] flex items-center gap-1">
              <Droplets className="w-3.5 h-3.5" /> 02 ВОДА:
            </span>
            <span className="text-slate-400">
              <kbd>↑</kbd> <kbd>←</kbd> <kbd>↓</kbd> <kbd>→</kbd> · <kbd>Enter</kbd> действие
            </span>
          </div>
          <div className="text-[11px] text-slate-400 truncate mt-0.5">
            {hudHeader.waterContext}
          </div>
        </div>

        <div className="flex items-center justify-between md:justify-end gap-4 text-[11px]">
          <span className="text-slate-400">
            <kbd>R</kbd> заново · <kbd>H</kbd> подсказка
          </span>
          <span className="font-mono text-slate-500">{fpsText}</span>
        </div>
      </footer>

      {/* Death Overlay */}
      {currentMode === 'dead' && (
        <div className="fixed inset-0 z-30 pointer-events-none flex items-center justify-center bg-rose-950/40 backdrop-blur-[2px]">
          <div className="bg-slate-900 border border-rose-500/60 rounded-xl p-6 text-center shadow-2xl max-w-sm space-y-2">
            <div className="text-rose-400 font-bold text-lg flex items-center justify-center gap-2">
              <ShieldAlert className="w-5 h-5" /> Контур разорван
            </div>
            <p className="text-xs text-rose-200">{deathReason}</p>
            <div className="text-[11px] text-slate-400 pt-1">
              Возврат к чекпоинту через 2 секунды...
            </div>
          </div>
        </div>
      )}

      {/* Main Menu Modal */}
      {currentMode === 'menu' && (
        <div className="fixed inset-0 z-40 bg-[#060d18e8] backdrop-blur-md flex items-center justify-center p-6 overflow-y-auto">
          <div className="bg-[#0e1826] border border-slate-700/80 rounded-2xl p-6 sm:p-10 max-w-2xl w-full shadow-2xl space-y-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="text-xs font-mono tracking-widest text-slate-400 uppercase">
                КООПЕРАТИВНАЯ ЭКСПЕДИЦИЯ ДЛЯ 2 ИГРОКОВ
              </div>
              <div className="flex items-center gap-1.5 text-xs font-mono bg-slate-900 border border-slate-800 px-2.5 py-1 rounded-md text-sky-400">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>Том 1 & Том 2</span>
              </div>
            </div>

            <div>
              <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white leading-tight">
                Эхо <span className="text-sky-400">Кондуита</span>
              </h1>
              <p className="text-sm text-slate-300 mt-2 leading-relaxed">
                Две стихии — Огонь и Вода. Открывайте путь друг другу, передавайте энергокубы,
                координируйте платформы и избегайте патрульных охранных дронов.
              </p>
            </div>

            {/* Quick Volume Switcher Card */}
            <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-3">
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                <Layers className="w-4 h-4 text-indigo-400" />
                <span>Выбор кампании:</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Volume 1 */}
                <button
                  onClick={() => setActiveVolume(1)}
                  className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                    activeVolume === 1
                      ? 'bg-sky-950/40 border-sky-500/80 ring-1 ring-sky-500/50'
                      : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-white">Том 1: Станция «Люмен»</span>
                    <span className="text-[11px] font-mono text-sky-400">13 секторов</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    Базовые кондуиты, синхронизаторы, гидравлика и ячейки энергии.
                  </p>
                </button>

                {/* Volume 2 */}
                <button
                  onClick={() => setActiveVolume(2)}
                  className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                    activeVolume === 2
                      ? 'bg-rose-950/40 border-rose-500/80 ring-1 ring-rose-500/50'
                      : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-white flex items-center gap-1.5">
                      <span>Том 2: Глубинный резонанс</span>
                    </span>
                    <span className="text-[10px] font-bold uppercase bg-rose-500/20 text-rose-300 border border-rose-500/40 px-1.5 py-0.5 rounded">
                      Сразу доступен
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    Повышенная сложность: летающие охранные дроны, блокировка кубами, новые ловушки.
                  </p>
                </button>
              </div>
            </div>

            {/* Controls summary */}
            <div className="grid grid-cols-2 gap-4 border-t border-slate-800 pt-4 text-xs">
              <div className="space-y-1">
                <span className="font-bold text-[#ff9459] flex items-center gap-1">
                  <Flame className="w-3.5 h-3.5" /> 01 ОГОНЬ
                </span>
                <p className="text-slate-400">
                  <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> перемещение<br />
                  <kbd>F</kbd> действие / поднять куб
                </p>
              </div>
              <div className="space-y-1">
                <span className="font-bold text-[#66d5ef] flex items-center gap-1">
                  <Droplets className="w-3.5 h-3.5" /> 02 ВОДА
                </span>
                <p className="text-slate-400">
                  <kbd>↑</kbd><kbd>←</kbd><kbd>↓</kbd><kbd>→</kbd> перемещение<br />
                  <kbd>Enter</kbd> действие / поднять куб
                </p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                onClick={() => {
                  initAudio();
                  if (activeVolume === 1) {
                    loadLevel(saveRef.current.last, saveRef.current.last === 12 ? saveRef.current.phase : 0);
                  } else {
                    // Volume 2 starts at index 13 (Sector 14)
                    loadLevel(13, 0);
                  }
                }}
                className="px-6 py-3 rounded-xl bg-white hover:bg-slate-200 text-slate-900 font-bold text-sm flex items-center gap-2 transition-colors cursor-pointer shadow-lg"
              >
                <Play className="w-4 h-4 fill-slate-900" />
                <span>
                  {activeVolume === 2
                    ? 'Играть в Том 2 · Сектор 14'
                    : saveRef.current.unlocked
                    ? `Продолжить · сектор ${saveRef.current.last + 1}`
                    : 'Начать экспедицию'}
                </span>
              </button>

              <button
                onClick={() => {
                  initAudio();
                  setCurrentMode('select');
                }}
                className="px-4 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-sm font-medium text-slate-200 transition-colors cursor-pointer"
              >
                Выбрать уровень
              </button>

              <button
                onClick={() => {
                  initAudio();
                  setCurrentMode('help');
                }}
                className="px-4 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-sm font-medium text-slate-300 transition-colors cursor-pointer"
              >
                Справка
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Level Select Modal */}
      {currentMode === 'select' && (
        <div className="fixed inset-0 z-40 bg-[#060d18e8] backdrop-blur-md flex items-center justify-center p-6 overflow-y-auto">
          <div className="bg-[#0e1826] border border-slate-700/80 rounded-2xl p-6 sm:p-8 max-w-3xl w-full shadow-2xl space-y-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div>
                <div className="text-xs font-mono tracking-wider text-slate-400 uppercase">
                  КАРТА КОНДУИТОВ
                </div>
                <h2 className="text-2xl font-bold text-white mt-1">Выберите сектор</h2>
              </div>

              {/* Volume Switcher Tabs */}
              <div className="flex bg-slate-900 border border-slate-800 p-1 rounded-xl">
                <button
                  onClick={() => setActiveVolume(1)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                    activeVolume === 1
                      ? 'bg-slate-800 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Том 1: Станция «Люмен»
                </button>
                <button
                  onClick={() => setActiveVolume(2)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                    activeVolume === 2
                      ? 'bg-rose-950/80 text-rose-300 border border-rose-500/40 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Том 2: Глубинный резонанс ★
                </button>
              </div>
            </div>

            {/* Grid of levels */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 max-h-[50vh] overflow-y-auto pr-1">
              {ALL_LEVELS.filter((l) => (activeVolume === 2 ? (l.volume || 1) === 2 : (l.volume || 1) === 1)).map(
                (l, localIdx) => {
                  const globalIdx = activeVolume === 2 ? 13 + localIdx : localIdx;
                  const isLocked =
                    activeVolume === 1
                      ? globalIdx > saveRef.current.unlocked
                      : false; // In Volume 2, unlocked levels can be played directly

                  return (
                    <button
                      key={globalIdx}
                      disabled={isLocked}
                      onClick={() => {
                        initAudio();
                        loadLevel(globalIdx, 0);
                      }}
                      className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 hover:border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-left transition-all hover:bg-slate-900 cursor-pointer flex flex-col justify-between min-h-[75px]"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-base font-bold text-sky-400">
                          {String(globalIdx + 1).padStart(2, '0')}
                        </span>
                        {activeVolume === 2 && (
                          <span className="text-[10px] uppercase font-bold text-rose-400 bg-rose-950/50 px-1 rounded">
                            Хардкор
                          </span>
                        )}
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-white truncate">
                          {l.title}
                        </div>
                        <div className="text-[11px] text-slate-400 truncate mt-0.5">
                          {isLocked ? 'Заблокирован' : l.idea}
                        </div>
                      </div>
                    </button>
                  );
                }
              )}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-800">
              <span className="text-xs text-slate-400">
                Найдено фрагментов кондуита: {saveRef.current.fragments.length}
              </span>
              <button
                onClick={() => setCurrentMode('menu')}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 transition-colors cursor-pointer"
              >
                Назад в меню
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pause Modal */}
      {currentMode === 'pause' && (
        <div className="fixed inset-0 z-40 bg-[#060d18e8] backdrop-blur-md flex items-center justify-center p-6">
          <div className="bg-[#0e1826] border border-slate-700/80 rounded-2xl p-6 sm:p-8 max-w-md w-full shadow-2xl space-y-5">
            <div className="border-b border-slate-800 pb-3">
              <div className="text-xs font-mono tracking-wider text-slate-400 uppercase">
                КОНТУР ПРИОСТАНОВЛЕН
              </div>
              <h2 className="text-xl font-bold text-white mt-1">
                {ALL_LEVELS[levelIndex]?.title}
              </h2>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Все механизмы, таймеры и охранные дроны остановлены. Можно обсудить дальнейшие шаги с напарником.
            </p>

            <div className="flex flex-col gap-2 pt-2">
              <button
                onClick={() => {
                  engineRef.current.mode = 'play';
                  setCurrentMode('play');
                }}
                className="w-full py-2.5 rounded-xl bg-white hover:bg-slate-200 text-slate-900 font-bold text-xs transition-colors cursor-pointer"
              >
                Продолжить · Esc
              </button>
              <button
                onClick={() => loadLevel(levelIndex, 0)}
                className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-medium text-slate-200 transition-colors cursor-pointer flex items-center justify-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Заново этот сектор · R</span>
              </button>
              <button
                onClick={restoreFromCheckpoint}
                className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-medium text-slate-200 transition-colors cursor-pointer"
              >
                К последнему чекпоинту
              </button>
              <button
                onClick={() => setCurrentMode('select')}
                className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-medium text-slate-200 transition-colors cursor-pointer"
              >
                Выбрать другой сектор
              </button>
              <button
                onClick={() => setCurrentMode('help')}
                className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-medium text-slate-300 transition-colors cursor-pointer"
              >
                Подсказка к уровню
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Help Modal */}
      {currentMode === 'help' && (
        <div className="fixed inset-0 z-40 bg-[#060d18e8] backdrop-blur-md flex items-center justify-center p-6 overflow-y-auto">
          <div className="bg-[#0e1826] border border-slate-700/80 rounded-2xl p-6 sm:p-8 max-w-2xl w-full shadow-2xl space-y-5">
            <div className="border-b border-slate-800 pb-3">
              <div className="text-xs font-mono tracking-wider text-slate-400 uppercase">
                СПРАВОЧНИК КОНДУИТА
              </div>
              <h2 className="text-xl font-bold text-white mt-1">Правила взаимодействия</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs leading-relaxed max-h-[45vh] overflow-y-auto pr-1">
              <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800">
                <span className="font-bold text-[#ff9459]">Огонь (квадрат):</span>
                <p className="text-slate-400 mt-1">
                  Растапливает лёд и сжигает лианы действием F. Выдерживает огонь и нагретые зоны, погибает в воде.
                </p>
              </div>
              <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800">
                <span className="font-bold text-[#66d5ef]">Вода (капля):</span>
                <p className="text-slate-400 mt-1">
                  Включает гидравлику и охлаждение через Enter. Выдерживает воду, погибает в жаре.
                </p>
              </div>
              <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800">
                <span className="font-bold text-rose-400">Патрульный дрон (Том 2):</span>
                <p className="text-slate-400 mt-1">
                  Курсирует по коридору. Прикосновение смертельно! Отключается рубильником или блокируется поставленным кубом.
                </p>
              </div>
              <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800">
                <span className="font-bold text-amber-300">Кубы и гнёзда P/Q:</span>
                <p className="text-slate-400 mt-1">
                  Поднимайте клавишей действия рядом с кубом, опускайте под собой. Груз в руках не давит на нажимные плиты.
                </p>
              </div>
            </div>

            {engineRef.current.L?.hints && engineRef.current.L.hints.length > 0 && (
              <div className="bg-indigo-950/40 border border-indigo-500/40 rounded-xl p-3 text-xs text-indigo-200">
                <span className="font-semibold text-indigo-300">
                  Подсказка {hintIndex + 1} из {engineRef.current.L.hints.length}:
                </span>
                <p className="mt-1">{engineRef.current.L.hints[hintIndex]}</p>
                {engineRef.current.L.hints.length > 1 && (
                  <button
                    onClick={() =>
                      setHintIndex(
                        (hintIndex + 1) % engineRef.current.L.hints!.length
                      )
                    }
                    className="mt-2 text-[11px] underline text-indigo-400 hover:text-indigo-200 cursor-pointer"
                  >
                    Следующая подсказка →
                  </button>
                )}
              </div>
            )}

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => {
                  engineRef.current.mode = 'play';
                  setCurrentMode('play');
                }}
                className="px-5 py-2.5 rounded-xl bg-white hover:bg-slate-200 text-slate-900 font-bold text-xs transition-colors cursor-pointer"
              >
                Вернуться в игру
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Victory Modal */}
      {currentMode === 'won' && (
        <div className="fixed inset-0 z-40 bg-[#060d18e8] backdrop-blur-md flex items-center justify-center p-6">
          <div className="bg-[#0e1826] border border-slate-700/80 rounded-2xl p-6 sm:p-8 max-w-md w-full shadow-2xl text-center space-y-5">
            <div className="w-12 h-12 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center mx-auto text-emerald-400">
              <CheckCircle className="w-6 h-6" />
            </div>

            <div>
              <div className="text-xs font-mono text-emerald-400 uppercase tracking-widest">
                КОНТУР СТАБИЛЕН
              </div>
              <h2 className="text-2xl font-bold text-white mt-1">Сектор пройден!</h2>
              <p className="text-xs text-slate-400 mt-2">
                Слаженность и командная работа позволили успешно преодолеть все препятствия сектора.
              </p>
            </div>

            <div className="flex flex-col gap-2 pt-2">
              <button
                onClick={() => {
                  const nextIdx = Math.min(ALL_LEVELS.length - 1, levelIndex + 1);
                  loadLevel(nextIdx, 0);
                }}
                className="w-full py-3 rounded-xl bg-white hover:bg-slate-200 text-slate-900 font-bold text-xs transition-colors cursor-pointer flex items-center justify-center gap-1.5"
              >
                <span>Следующий сектор</span>
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                onClick={() => loadLevel(levelIndex, 0)}
                className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-medium text-slate-300 transition-colors cursor-pointer"
              >
                Пройти сектор заново
              </button>
              <button
                onClick={() => setCurrentMode('select')}
                className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-medium text-slate-300 transition-colors cursor-pointer"
              >
                Карта секторов
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
