<script lang="ts">
  import { translations } from '../lib/i18n.ts';
  import type { WorkspaceState } from '../lib/state.svelte.ts';
  import type { CutSettings, Motif } from '../lib/stickers.ts';

  let { state, motif }: { state: WorkspaceState; motif: Motif } = $props();
  const set = <K extends keyof CutSettings>(key: K, value: CutSettings[K]) => state.setSetting(motif.id, key, value);
  const finite = (value: string, fallback: number) => value === '' ? fallback : Number(value);
</script>

<div class="cut-panel">
  <label class="field-row" for={`bleed-${motif.id}`}>
    <span>{$translations('cut.bleed')}</span>
    <span class="number-with-unit"><input id={`bleed-${motif.id}`} type="number" min="0" max="20" step="0.1" inputmode="decimal" value={motif.cut.bleedMm} onchange={(event) => set('bleedMm', Math.max(0, finite(event.currentTarget.value, 0)))} /><span>mm</span></span>
  </label>
  <input class="range-input" type="range" min="0" max="10" step="0.1" aria-label={$translations('cut.bleed')} value={motif.cut.bleedMm} oninput={(event) => set('bleedMm', Number(event.currentTarget.value))} />
  <p class="field-help">{$translations('cut.bleedHelp')}</p>

  <label class="field-row" for={`contour-${motif.id}`}>
    <span>{$translations('cut.contour')}</span>
    <span class="number-with-unit"><input id={`contour-${motif.id}`} type="number" min="0" max="5" step="0.1" inputmode="decimal" aria-describedby={`contour-help-${motif.id}`} value={motif.cut.contourMm} onchange={(event) => set('contourMm', Math.min(5, Math.max(0, finite(event.currentTarget.value, 0))))} /><span>mm</span></span>
  </label>
  <input class="range-input" type="range" min="0" max="5" step="0.1" aria-label={$translations('cut.contour')} value={motif.cut.contourMm} onchange={(event) => set('contourMm', Number(event.currentTarget.value))} />
  <p class="field-help" id={`contour-help-${motif.id}`}>{$translations('cut.contourHelp')}</p>

  <label class="field-row" for={`border-mode-${motif.id}`}><span>{$translations('cut.border')}</span>
    <select id={`border-mode-${motif.id}`} value={motif.cut.borderMode} onchange={(event) => set('borderMode', event.currentTarget.value as 'none' | 'paper' | 'color')}>
      <option value="none">{$translations('cut.border.none')}</option>
      <option value="paper">{$translations('cut.border.paper')}</option>
      <option value="color">{$translations('cut.border.color')}</option>
    </select>
  </label>
  {#if motif.cut.borderMode !== 'none'}
    <label class="field-row" for={`border-width-${motif.id}`}><span>{$translations('cut.borderWidth')}</span><span class="number-with-unit"><input id={`border-width-${motif.id}`} type="number" min="0" max="20" step="0.1" inputmode="decimal" value={motif.cut.borderMm} onchange={(event) => set('borderMm', Math.max(0, finite(event.currentTarget.value, 0)))} /><span>mm</span></span></label>
    <input class="range-input" type="range" min="0" max="10" step="0.1" aria-label={$translations('cut.borderWidth')} value={motif.cut.borderMm} oninput={(event) => set('borderMm', Number(event.currentTarget.value))} />
  {/if}
  {#if motif.cut.borderMode === 'color'}
    <label class="field-row" for={`border-color-${motif.id}`}><span>{$translations('cut.borderColor')}</span><input id={`border-color-${motif.id}`} type="color" value={motif.cut.borderColor} oninput={(event) => set('borderColor', event.currentTarget.value)} /></label>
  {/if}

  <details class="advanced-controls">
    <summary>{$translations('cut.advanced')}</summary>
    <div class="advanced-fields">
      <label class="field-row" for={`inset-${motif.id}`}><span>{$translations('cut.inset')}</span><span class="number-with-unit"><input id={`inset-${motif.id}`} type="number" min="0" max="20" step="0.1" inputmode="decimal" value={motif.cut.insetMm} onchange={(event) => set('insetMm', Math.max(0, finite(event.currentTarget.value, 0)))} /><span>mm</span></span></label>
      <label class="field-row" for={`merge-${motif.id}`}><span>{$translations('cut.mergeNearby')}</span><span class="number-with-unit"><input id={`merge-${motif.id}`} type="number" min="0" max="20" step="0.1" inputmode="decimal" value={motif.cut.mergeMm} onchange={(event) => set('mergeMm', Math.max(0, finite(event.currentTarget.value, 0)))} /><span>mm</span></span></label>
      <label class="field-row" for={`smooth-${motif.id}`}><span>{$translations('cut.smoothing')}</span><input id={`smooth-${motif.id}`} type="number" min="2" max="6" step="0.5" inputmode="decimal" value={motif.cut.smooth} onchange={(event) => set('smooth', Math.max(2, Math.min(6, finite(event.currentTarget.value, 2))))} /></label>
      <label class="check-row"><input type="checkbox" checked={motif.cut.fillHoles} onchange={(event) => set('fillHoles', event.currentTarget.checked)} />{$translations('cut.fillHoles')}</label>
      <label class="check-row"><input type="checkbox" checked={motif.cut.bleedIntoHoles} onchange={(event) => set('bleedIntoHoles', event.currentTarget.checked)} />{$translations('cut.bleedIntoHoles')}</label>
      <label class="field-row" for={`threshold-${motif.id}`}><span>{$translations('cut.alphaThreshold')}</span><input id={`threshold-${motif.id}`} type="number" min="1" max="255" step="1" inputmode="numeric" value={motif.cut.alphaThreshold} onchange={(event) => set('alphaThreshold', Math.max(1, Math.min(255, Math.round(finite(event.currentTarget.value, 128)))))} /></label>
      <label class="field-row" for={`erode-${motif.id}`}><span>{$translations('cut.erode')}</span><input id={`erode-${motif.id}`} type="number" min="0" max="6" step="1" inputmode="numeric" value={motif.cut.erodePx} onchange={(event) => set('erodePx', Math.max(0, Math.min(6, Math.round(finite(event.currentTarget.value, 0)))))} /></label>
    </div>
  </details>
  {#if state.collection.items.length > 1}
    <button type="button" class="apply-all" onclick={() => state.applyCutToAll(motif.id)}>{$translations('cut.applyAll')}</button>
  {/if}
</div>
