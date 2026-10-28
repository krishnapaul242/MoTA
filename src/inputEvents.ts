export interface Display { width: number; height: number; rotation: number }
export interface PointStroke { pointerId: number; startMs: number; durationMs: number; points: number[][] }
export type Action = { type: 'gesture'; atMs: number; delayMs: number; width: number; height: number; rotation: number; strokes: PointStroke[]; dispatch: 'completed' }
  | { type: 'global'; atMs: number; delayMs: number; action: number }
  | { type: 'volume'; atMs: number; delayMs: number; keyCode: number }
  | { type: 'text'; atMs: number; delayMs: number; text: string };
export interface TouchDevice { path: string; name: string; xMin: number; xMax: number; yMin: number; yMax: number; protocol?: 'a' | 'b' }
export function touchDevices(output: string): TouchDevice[] {
  return output.split(/(?=add device \d+:)/).flatMap(block => {
    const path = block.match(/^add device \d+: (\/dev\/input\/event\d+)/)?.[1];
    const axis = (name: string) => block.match(new RegExp(name + '\\s*:[^\\n]*?min\\s+(-?\\d+),?\\s+max\\s+(\\d+)'));
    const x = axis('ABS_MT_POSITION_X'), y = axis('ABS_MT_POSITION_Y');
    if (!path || !x || !y || !block.includes('ABS_MT_TRACKING_ID') || +x[2] <= +x[1] || +y[2] <= +y[1]) return [];
    const device: TouchDevice = { path, name: block.match(/name:\s*"([^"]+)"/)?.[1] || path, xMin: +x[1], xMax: +x[2], yMin: +y[1], yMax: +y[2] };
    // Preserve the original shape for protocol B callers. No slots means protocol A.
    if (!block.includes('ABS_MT_SLOT')) device.protocol = 'a';
    return [device];
  });
}
interface Slot { x?: number; y?: number; down: boolean; released: boolean; stroke?: PointStroke }
interface InputEvent { at: number; path: string; type: string; code: string; value: number }
interface Contact { id?: number; x?: number; y?: number; at?: number }
/** Selects the active physical touchscreen from its first contact; supports Linux MT protocols A and B. */
export class InputDecoder {
  private slot = 0;
  private slots = new Map<number, Slot>();
  private strokes: PointStroke[] = [];
  private start?: number;
  private lastEnd = 0;
  private points = 0;
  private candidates: Map<string, TouchDevice>;
  private pending = new Map<string, InputEvent[]>();
  private selected?: TouchDevice;
  private contact: Contact = {};
  private frame = new Map<number, Contact>();
  private allReleased = false;
  constructor(devices: TouchDevice | TouchDevice[], readonly display: Display, readonly originMs: number, private emit: (action: Action) => void) {
    if (display.rotation !== 0) throw new Error('ADB input recording requires the natural display orientation. Use overlay recording in this orientation.');
    this.candidates = new Map((Array.isArray(devices) ? devices : [devices]).map(d => [d.path, d]));
    if (!this.candidates.size) throw new Error('No supported touchscreen was found.');
  }
  get incomplete() { return this.start !== undefined; }
  get activeDevice() { return this.selected; }
  line(line: string) {
    if (/permission denied|could not open|could not get driver/i.test(line)) throw new Error('Android denied raw input capture. Use overlay recording.');
    const m = line.trim().match(/^\[\s*(\d+\.\d+)\]\s+(\/dev\/input\/event\d+):\s+(EV_\w+)\s+(\w+)\s+([0-9a-fA-F]+|UP|DOWN)$/);
    if (!m) return;
    const [, time, path, type, code, raw] = m;
    const e: InputEvent = { at: Math.max(0, Math.round(+time * 1000 - this.originMs)), path, type, code, value: raw === 'DOWN' ? 1 : raw === 'UP' ? 0 : parseInt(raw, 16) };
    if (type === 'EV_KEY' && e.value === 1 && this.start === undefined) {
      const global: Record<string, number> = { KEY_BACK: 1, KEY_HOME: 2, KEY_HOMEPAGE: 2, KEY_APPSELECT: 3 };
      const key: Record<string, number> = { KEY_VOLUMEUP: 24, KEY_VOLUMEDOWN: 25 };
      if (global[code] || key[code]) {
        this.emit(global[code] ? { type: 'global', atMs: e.at, delayMs: Math.max(0, e.at - this.lastEnd), action: global[code] }
          : { type: 'volume', atMs: e.at, delayMs: Math.max(0, e.at - this.lastEnd), keyCode: key[code] }); this.lastEnd = e.at;
      }
    }
    if (!this.selected) {
      if (!this.candidates.has(path)) return;
      if(code==='SYN_DROPPED')throw new Error('Android dropped input events. The recording is incomplete; record it again.');
      const buffered = this.pending.get(path) || [];
      buffered.push(e); if (buffered.length > 128) buffered.shift(); this.pending.set(path, buffered);
      if (code !== 'ABS_MT_TRACKING_ID' || e.value === 0xffffffff) return;
      this.selected = this.candidates.get(path)!; this.pending.clear();
      // Slot/coordinates can precede TRACKING_ID in the first frame.
      for (const event of buffered) this.touch(event);
    } else if (path === this.selected.path) this.touch(e);
  }
  private touch(e: InputEvent) {
    if (e.code === 'SYN_DROPPED') throw new Error('Android dropped input events. The recording is incomplete; record it again.');
    if (this.selected!.protocol === 'a') this.protocolA(e); else this.protocolB(e);
  }
  private position(value: number, min: number, max: number, size: number) {
    const signed = min < 0 ? value | 0 : value;
    return Math.max(0, Math.min(size - 1, (signed - min) / (max - min) * (size - 1)));
  }
  private newStroke(slot: Slot, id: number, at: number) {
    if (this.start === undefined) { this.start = at; this.strokes = []; this.points = 0; }
    if (this.strokes.length >= 10) throw new Error('Gesture exceeds ten strokes.');
    slot.down = true; slot.released = false;
    slot.stroke = { pointerId: id, startMs: Math.max(0, at - this.start), durationMs: 1, points: [] }; this.strokes.push(slot.stroke);
  }
  private protocolB(e: InputEvent) {
    const { at, code, value } = e, device = this.selected!;
    if (code === 'ABS_MT_SLOT') { if (value > 99) throw new Error('Unsupported input slot.'); this.slot = value; return; }
    let slot = this.slots.get(this.slot);
    if (!slot) { slot = { down: false, released: false }; this.slots.set(this.slot, slot); }
    if (code === 'ABS_MT_TRACKING_ID') {
      if (value === 0xffffffff) slot.released = true;
      else this.newStroke(slot, this.slot, at);
    }
    if (code === 'ABS_MT_POSITION_X') slot.x = this.position(value, device.xMin, device.xMax, this.display.width);
    if (code === 'ABS_MT_POSITION_Y') slot.y = this.position(value, device.yMin, device.yMax, this.display.height);
    if (code === 'SYN_REPORT') this.commit(at);
  }
  private flushContact() {
    if (this.contact.id !== undefined && this.contact.id !== 0xffffffff) this.frame.set(this.contact.id, this.contact);
    this.contact = {};
  }
  private protocolA(e: InputEvent) {
    const { at, code, value } = e, device = this.selected!;
    if (code === 'BTN_TOUCH' && value === 0) this.allReleased = true;
    if (code === 'ABS_MT_TRACKING_ID') { this.contact.id = value; this.contact.at = at; }
    if (code === 'ABS_MT_POSITION_X') this.contact.x = this.position(value, device.xMin, device.xMax, this.display.width);
    if (code === 'ABS_MT_POSITION_Y') this.contact.y = this.position(value, device.yMin, device.yMax, this.display.height);
    if (code === 'SYN_MT_REPORT') this.flushContact();
    if (code !== 'SYN_REPORT') return;
    this.flushContact();
    if (this.allReleased) this.frame.clear();
    for (const [id, contact] of this.frame) {
      let slot = this.slots.get(id);
      if (!slot) { slot = { down: false, released: false }; this.slots.set(id, slot); }
      if (!slot.down) this.newStroke(slot, id, contact.at ?? at);
      if (contact.x !== undefined) slot.x = contact.x;
      if (contact.y !== undefined) slot.y = contact.y;
    }
    for (const [id, slot] of this.slots) if (slot.down && !this.frame.has(id)) slot.released = true;
    this.commit(at); this.frame.clear(); this.allReleased = false;
  }
  private commit(at: number) {
    if (this.start === undefined) return;
    if (at - this.start > 59000) throw new Error('Gesture exceeds the supported 59-second duration.');
    for (const current of this.slots.values()) {
      if (!current.down || !current.stroke) continue;
      if (current.x === undefined || current.y === undefined) { if (current.released) throw new Error('Touch coordinates are missing.'); continue; }
      const p = [current.x, current.y, Math.max(current.stroke.startMs, at - this.start)];
      const points = current.stroke.points, previous = points.at(-1);
      if (!previous || previous[0] !== p[0] || previous[1] !== p[1] || current.released) { points.push(p); if (++this.points > 20000) throw new Error('Gesture exceeds 20,000 samples.'); }
      current.stroke.durationMs = Math.max(1, p[2] - current.stroke.startMs);
      if (current.released) { current.down = false; current.stroke = undefined; current.released = false; }
    }
    if ([...this.slots.values()].every(s => !s.down)) {
      const action: Action = { type: 'gesture', atMs: this.start, delayMs: Math.max(0, this.start - this.lastEnd), ...this.display, strokes: this.strokes, dispatch: 'completed' };
      this.lastEnd = at; this.start = undefined;
      if (action.strokes.some(s => !s.points.length)) throw new Error('Incomplete touch coordinates.'); this.emit(action);
    }
  }
}
