import { get } from 'svelte/store';
import { exportAlignmentTest, exportSheet, exportSticker, type SheetExportKind, type StickerExportKind } from './export.ts';
import { locale, t } from './i18n.ts';
import { MACHINES, defaultSheetSettings, planSheet, type MachineKey, type MatKey, type Notice, type PlanOutcome, type SheetSettings } from './sheets.ts';

const machineStorageKey = 'stickerwerkstatt.machine';

/** The machine and mat rarely change, so they are remembered in this browser. */
function rememberedMachine(): Pick<SheetSettings, 'machine' | 'mat' | 'offsetXMm' | 'offsetYMm'> {
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(machineStorageKey) ?? 'null');
    if (saved && saved.machine in MACHINES && (MACHINES[saved.machine as MachineKey] as (MatKey | null)[]).concat(saved.machine === 'none' ? [null] : []).includes(saved.mat)) {
      const offset = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
      return { machine: saved.machine, mat: saved.mat, offsetXMm: offset(saved.offsetXMm), offsetYMm: offset(saved.offsetYMm) };
    }
  } catch { /* Storage can be disabled or hold old data. */ }
  return { machine: defaultSheetSettings.machine, mat: defaultSheetSettings.mat, offsetXMm: 0, offsetYMm: 0 };
}

function rememberMachine(settings: SheetSettings): void {
  try { globalThis.localStorage?.setItem(machineStorageKey, JSON.stringify({ machine: settings.machine, mat: settings.mat, offsetXMm: settings.offsetXMm, offsetYMm: settings.offsetYMm })); } catch { /* Keep it for this page only. */ }
}
import { computeSticker, createCollection, duplicateMotif, loadMotifFiles, mirrorMotif, removeCut, restoreCut, type Collection, type CutSettings, type LoadError, type Motif, type StickerResult } from './stickers.ts';

export class WorkspaceState {
  collection = $state<Collection>(createCollection());
  result = $state.raw<StickerResult | null>(null);
  errors = $state<LoadError[]>([]);
  processing = $state(false);
  error = $state<'error.noVisiblePixels' | 'error.cutFailed' | null>(null);
  sheetSettings = $state<SheetSettings>({ ...defaultSheetSettings, ...rememberedMachine(), paper: get(locale) === 'de' ? 'a4' : 'letter' });
  sheet = $state.raw<PlanOutcome | null>(null);
  sheetBusy = $state(false);
  exportNotices = $state.raw<Notice[]>([]);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sheetTimer: ReturnType<typeof setTimeout> | null = null;
  private sheetToken = 0;
  private sheetActive = false;

  get selected(): Motif | null {
    return this.collection.items.find((item) => item.id === this.collection.selectedId) ?? null;
  }

  async load(files: Iterable<File>): Promise<void> {
    // FileList is live: copy it before the input or drop event clears it.
    const snapshot = Array.from(files);
    this.processing = true;
    const { added, errors } = await loadMotifFiles(snapshot, this.collection);
    this.errors = errors;
    if (added.length) this.schedule(0);
    else this.processing = false;
  }

  select(id: number): void {
    this.collection.select(id);
    this.schedule(0);
  }

  remove(id: number): void {
    this.collection.remove(id);
    this.errors = [];
    this.schedule(0);
  }

  /** Remove or bring back one cut line of the selected motif. */
  toggleCut(loopIndex: number, removed: boolean): void {
    const motif = this.selected, result = this.result;
    if (!motif || !result) return;
    const loop = removed ? result.removedLoops[loopIndex] : result.loops[loopIndex];
    if (!loop) return;
    if (removed) restoreCut(motif, result, loop); else removeCut(motif, result, loop);
    this.schedule(0);
  }

  restoreAllCuts(): void {
    if (!this.selected) return;
    this.selected.removedCuts = [];
    this.schedule(0);
  }

  duplicate(id: number): void {
    if (duplicateMotif(this.collection, id)) this.schedule(0);
  }

  mirror(id: number): void {
    const motif = this.collection.items.find((item) => item.id === id);
    if (!motif) return;
    mirrorMotif(motif);
    if (id !== this.collection.selectedId) this.collection.select(id);
    this.schedule(0);
  }

  setHeight(id: number, value: number | ''): void {
    const motif = this.collection.items.find((item) => item.id === id);
    if (!motif) return;
    motif.heightMm = value === '' || !Number.isFinite(value) || value <= 0 ? null : Math.max(0.5, value);
    if (id !== this.collection.selectedId) this.collection.select(id);
    this.schedule(0);
  }

  setCopies(id: number, value: number | ''): void {
    const motif = this.collection.items.find((item) => item.id === id);
    if (!motif) return;
    motif.copies = value === '' || !Number.isFinite(value) ? '' : Math.max(1, Math.floor(value));
    this.scheduleSheet();
  }

  setSetting<K extends keyof CutSettings>(id: number, key: K, value: CutSettings[K]): void {
    const motif = this.collection.items.find((item) => item.id === id);
    if (!motif) return;
    motif.cut[key] = value;
    if (id !== this.collection.selectedId) this.collection.select(id);
    this.schedule();
  }

  applyCutToAll(id: number): void {
    const source = this.collection.items.find((item) => item.id === id);
    if (!source) return;
    const cut = $state.snapshot(source.cut) as CutSettings;
    for (const motif of this.collection.items) if (motif !== source) motif.cut = { ...cut };
    this.schedule(0);
  }

  setSheetSetting<K extends keyof SheetSettings>(key: K, value: SheetSettings[K]): void {
    this.sheetSettings[key] = value;
    if (key === 'machine' || key === 'mat') rememberMachine(this.sheetSettings);
    this.scheduleSheet();
  }

  /** Print-only options do not change the layout, so the sheet is not planned again. */
  setPrintOption(key: 'scissorLine', value: boolean): void {
    this.sheetSettings[key] = value;
  }

  /** The measured offset only changes the cut file, so the sheet is not planned again. */
  setOffset(key: 'offsetXMm' | 'offsetYMm', value: number): void {
    this.sheetSettings[key] = Number.isFinite(value) ? Math.max(-15, Math.min(15, value)) : 0;
    rememberMachine(this.sheetSettings);
  }

  async exportAlignment(kind: 'pdf' | 'svg'): Promise<void> {
    this.exportNotices = [];
    await exportAlignmentTest(kind, $state.snapshot(this.sheetSettings) as SheetSettings, t('export.alignmentTitle'), (notice) => { this.exportNotices = [...this.exportNotices, notice]; });
  }

  setMachine(machine: MachineKey): void {
    this.sheetSettings.mat = MACHINES[machine][0] ?? null;
    this.setSheetSetting('machine', machine);
  }

  schedule(delay = 160): void {
    if (this.timer) clearTimeout(this.timer);
    this.scheduleSheet(delay + 40);
    if (!this.selected || this.selected.heightMm === null) {
      this.result = null;
      this.processing = false;
      this.error = null;
      return;
    }
    this.result = null;
    this.processing = true;
    this.error = null;
    this.timer = setTimeout(() => {
      this.timer = null;
      const selected = this.selected;
      if (!selected) return;
      try { this.result = computeSticker(selected, selected.cut); }
      catch (error) { this.error = error instanceof Error && error.message === 'No pixels above alpha threshold' ? 'error.noVisiblePixels' : 'error.cutFailed'; }
      finally { this.processing = false; }
    }, delay);
  }

  /** The sheet is only planned while its step is visible; elsewhere it is marked out of date. */
  setSheetActive(active: boolean): void {
    this.sheetActive = active;
    if (active) this.scheduleSheet(0);
  }

  scheduleSheet(delay = 200): void {
    if (this.sheetTimer) clearTimeout(this.sheetTimer);
    const token = ++this.sheetToken;
    this.sheet = null;
    this.exportNotices = [];
    this.sheetBusy = this.sheetActive && this.collection.items.length > 0;
    if (!this.sheetBusy) return;
    this.sheetTimer = setTimeout(() => { this.sheetTimer = null; void this.plan(token); }, delay);
  }

  private async plan(token: number): Promise<void> {
    const cancelled = () => token !== this.sheetToken;
    try {
      const sized = this.collection.items.filter((motif) => motif.heightMm !== null);
      const missing: Notice[] = this.collection.items.filter((motif) => motif.heightMm === null)
        .map((motif) => ({ key: 'sheet.heightMissing', params: { name: motif.name } }));
      if (!sized.length) { this.sheet = { ok: false, error: { key: 'sheet.heightMissingAll', params: {} } }; return; }
      const entries = sized.map((motif) => ({
        motif, result: computeSticker(motif, motif.cut), want: typeof motif.copies === 'number' ? motif.copies : 0,
      }));
      const outcome = await planSheet(entries, $state.snapshot(this.sheetSettings) as SheetSettings, { cancelled });
      if (outcome?.ok) outcome.plan.warnings.unshift(...missing);
      if (outcome && !cancelled()) this.sheet = outcome;
    } catch (error) {
      if (!cancelled()) this.sheet = { ok: false, error: { key: 'error.sheetFailed', params: { reason: error instanceof Error ? error.message : String(error) } } };
    } finally {
      if (!cancelled()) this.sheetBusy = false;
    }
  }

  async exportSheet(kind: SheetExportKind): Promise<void> {
    const outcome = this.sheet;
    if (!outcome?.ok || this.sheetBusy) return;
    this.exportNotices = [];
    await exportSheet(kind, outcome.plan, $state.snapshot(this.sheetSettings) as SheetSettings, (notice) => { this.exportNotices = [...this.exportNotices, notice]; });
  }

  async exportSticker(kind: StickerExportKind): Promise<void> {
    const motif = this.selected, result = this.result;
    if (!motif || !result || this.processing) return;
    this.exportNotices = [];
    await exportSticker(kind, motif, result, (notice) => { this.exportNotices = [...this.exportNotices, notice]; });
  }
}

export const workspace = new WorkspaceState();
