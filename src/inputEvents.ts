export interface Display { width: number; height: number; rotation: number }
export interface PointStroke { pointerId: number; startMs: number; durationMs: number; points: number[][] }
export type Action = { type: 'gesture'; atMs: number; delayMs: number; width: number; height: number; rotation: number; strokes: PointStroke[]; dispatch: 'completed' }
  | { type: 'global'; atMs: number; delayMs: number; action: number }
  | { type: 'volume'; atMs: number; delayMs: number; keyCode: number }
  | { type: 'text'; atMs: number; delayMs: number; text: string };
export interface TouchDevice { path: string; name: string; xMin: number; xMax: number; yMin: number; yMax: number }
export function touchDevices(output: string): TouchDevice[] {
  return output.split(/(?=add device \d+:)/).flatMap(block => {
    const path = block.match(/^add device \d+: (\/dev\/input\/event\d+)/)?.[1];
    const axis = (name: string) => block.match(new RegExp(name + '\\s*:[^\\n]*?min\\s+(-?\\d+),?\\s+max\\s+(\\d+)'));
    const x = axis('ABS_MT_POSITION_X'), y = axis('ABS_MT_POSITION_Y');
    if (!path || !x || !y || (!block.includes('ABS_MT_TRACKING_ID') || !block.includes('ABS_MT_SLOT')) || +x[2] <= +x[1] || +y[2] <= +y[1]) return [];
    return [{ path, name: block.match(/name:\s*"([^"]+)"/)?.[1] || path, xMin: +x[1], xMax: +x[2], yMin: +y[1], yMax: +y[2] }];
  });
}
interface Slot { x?: number; y?: number; down: boolean; released: boolean; stroke?: PointStroke }
/** Linux MT protocol B. Records physical input without intercepting it. Natural display orientation only. */
export class InputDecoder {
  private slot = 0;
  private slots = new Map<number, Slot>();
  private strokes: PointStroke[] = [];
  private start?: number;
  private lastEnd = 0;
  private points = 0;
  constructor(readonly device: TouchDevice, readonly display: Display, readonly originMs: number, private emit: (action: Action) => void) {
    if (display.rotation !== 0) throw new Error('ADB input recording requires the natural display orientation. Use overlay recording in this orientation.');
  }
  get incomplete() { return this.start !== undefined; }
  line(line: string) {
    if (/permission denied|could not open|could not get driver/i.test(line)) throw new Error('Android denied raw input capture. Use overlay recording.');
    const m = line.match(/\[\s*(\d+\.\d+)\]\s+(\/dev\/input\/event\d+):\s+(EV_\w+)\s+(\w+)\s+([0-9a-fA-F]+|UP|DOWN)$/);
    if (!m) return;
    const at = Math.max(0, Math.round(+m[1] * 1000 - this.originMs));
    const [, , path, type, code, raw] = m;
    const value = raw === 'DOWN' ? 1 : raw === 'UP' ? 0 : parseInt(raw, 16);
    if (type === 'EV_KEY' && value === 1) {
      const global: Record<string, number> = { KEY_BACK: 1, KEY_HOME: 2, KEY_HOMEPAGE: 2, KEY_APPSELECT: 3 };
      const key: Record<string, number> = { KEY_VOLUMEUP: 24, KEY_VOLUMEDOWN: 25 };
      if ((global[code] || key[code]) && this.start === undefined) {
        this.emit(global[code] ? { type: 'global', atMs: at, delayMs: Math.max(0, at - this.lastEnd), action: global[code] }
          : { type: 'volume', atMs: at, delayMs: Math.max(0, at - this.lastEnd), keyCode: key[code] }); this.lastEnd = at;
      }
    }
    if (path !== this.device.path) return;
    if (code === 'SYN_DROPPED') throw new Error('Android dropped input events. The recording is incomplete; record it again.');
    if (code === 'ABS_MT_SLOT') { if (value > 99) throw new Error('Unsupported input slot.'); this.slot = value; return; }
    let slot = this.slots.get(this.slot);
    if (!slot) { slot = { down: false, released: false }; this.slots.set(this.slot, slot); }
    if (code === 'ABS_MT_TRACKING_ID') {
      if (value === 0xffffffff) slot.released = true;
      else {
        if (this.start === undefined) { this.start = at; this.strokes = []; this.points = 0; }
        if (this.strokes.length >= 10) throw new Error('Gesture exceeds ten strokes.');
        slot.down = true; slot.released = false;
        slot.stroke = { pointerId: this.slot, startMs: at - this.start, durationMs: 1, points: [] }; this.strokes.push(slot.stroke);
      }
    }
    if (code === 'ABS_MT_POSITION_X') slot.x = (value - this.device.xMin) / (this.device.xMax - this.device.xMin) * (this.display.width - 1);
    if (code === 'ABS_MT_POSITION_Y') slot.y = (value - this.device.yMin) / (this.device.yMax - this.device.yMin) * (this.display.height - 1);
    if (code !== 'SYN_REPORT' || this.start === undefined) return;
    if (at - this.start > 59000) throw new Error('Gesture exceeds the supported 59-second duration.');
    for (const current of this.slots.values()) {
      if (!current.down || !current.stroke) continue;
      if (current.x === undefined || current.y === undefined) { if (current.released) throw new Error('Touch coordinates are missing.'); continue; }
      const p = [Math.max(0, Math.min(this.display.width - 1, current.x)), Math.max(0, Math.min(this.display.height - 1, current.y)), at - this.start];
      const points = current.stroke.points, previous = points.at(-1);
      if (!previous || previous[0] !== p[0] || previous[1] !== p[1] || current.released) { points.push(p); if (++this.points > 20000) throw new Error('Gesture exceeds 20,000 samples.'); }
      current.stroke.durationMs = Math.max(1, at - this.start - current.stroke.startMs);
      if (current.released) { current.down = false; current.stroke = undefined; current.released = false; }
    }
    if ([...this.slots.values()].every(s => !s.down)) {
      const action: Action = { type: 'gesture', atMs: this.start, delayMs: Math.max(0, this.start - this.lastEnd), ...this.display, strokes: this.strokes, dispatch: 'completed' };
      this.lastEnd = at; this.start = undefined;
      if (action.strokes.some(s => !s.points.length)) throw new Error('Incomplete touch coordinates.'); this.emit(action);
    }
  }
}
