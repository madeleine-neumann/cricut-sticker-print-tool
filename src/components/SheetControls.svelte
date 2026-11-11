<script lang="ts">
  import { locale, translations, type TranslationKey } from '../lib/i18n.ts';
  import { MACHINES, machineKeys, matInfo, paperKeys, type MachineKey, type MatKey, type PaperKey, type RotationMode, type SheetSettings } from '../lib/sheets.ts';
  import type { WorkspaceState } from '../lib/state.svelte.ts';

  let { state: model }: { state: WorkspaceState } = $props();
  const settings = $derived(model.sheetSettings);
  const multi = $derived(model.collection.items.length > 1);
  const info = $derived(matInfo(settings));
  const rotations: RotationMode[] = ['none', '180', '90', '45', '15'];
  const mm = (value: string, fallback: number) => { const n = Number(value); return value === '' || !Number.isFinite(n) ? fallback : Math.max(0, n); };
  const fmt = $derived.by(() => { const language = $locale; return (value: number) => new Intl.NumberFormat(language, { maximumFractionDigits: 0 }).format(value); });
</script>

<section class="sheet-panel" aria-labelledby="sheet-controls-title">
  <h3 id="sheet-controls-title">{$translations('sheet.title')}</h3>

  <label class="field-stack" for="machine"><span>{$translations('sheet.machine')}</span>
    <select id="machine" value={settings.machine} onchange={(event) => model.setMachine(event.currentTarget.value as MachineKey)}>
      {#each machineKeys as key}<option value={key}>{$translations(`sheet.machine.${key}` as TranslationKey)}</option>{/each}
    </select>
  </label>
  {#if MACHINES[settings.machine].length}
    <label class="field-stack" for="mat"><span>{$translations('sheet.mat')}</span>
      <select id="mat" value={settings.mat} disabled={MACHINES[settings.machine].length < 2} onchange={(event) => model.setSheetSetting('mat', event.currentTarget.value as MatKey)}>
        {#each MACHINES[settings.machine] as key}<option value={key}>{$translations(`sheet.mat.${key}` as TranslationKey)}</option>{/each}
      </select>
    </label>
  {/if}

  <label class="field-stack" for="paper"><span>{$translations('sheet.paper')}</span>
    <select id="paper" value={settings.paper} aria-describedby="mat-help" onchange={(event) => model.setSheetSetting('paper', event.currentTarget.value as PaperKey)}>
      {#each paperKeys as key}<option value={key}>{$translations(`sheet.paper.${key}` as TranslationKey)}</option>{/each}
    </select>
  </label>
  {#if info.mat}
    <p class="field-help" id="mat-help">
      {$translations('sheet.cutArea', { w: fmt(info.mat.cutW), h: fmt(info.mat.cutH) })}
      {#if !info.fitsOnMat}{$translations('sheet.matTiled')}{:else if info.limitedByMat}{$translations('sheet.matLimited')}{/if}
    </p>
  {/if}

  <label class="field-stack" for="arrangement"><span>{$translations('sheet.layout')}</span>
    <select id="arrangement" value={multi ? 'nest' : settings.arrangement} disabled={multi} aria-describedby={multi ? 'arrangement-help' : undefined} onchange={(event) => model.setSheetSetting('arrangement', event.currentTarget.value as SheetSettings['arrangement'])}>
      <option value="nest">{$translations('sheet.layout.nested')}</option>
      <option value="grid">{$translations('sheet.layout.grid')}</option>
    </select>
  </label>
  {#if multi}<p class="field-help" id="arrangement-help">{$translations('sheet.layoutMultiHint')}</p>{/if}

  {#if multi || settings.arrangement === 'nest'}
    <label class="field-stack" for="rotation"><span>{$translations('sheet.rotation')}</span>
      <select id="rotation" value={settings.rotation} onchange={(event) => model.setSheetSetting('rotation', event.currentTarget.value as RotationMode)}>
        {#each rotations as rotation}<option value={rotation}>{$translations(`sheet.rotation.${rotation}` as TranslationKey)}</option>{/each}
      </select>
    </label>
  {/if}

  {#if info.fitsOnMat}
    <label class="field-stack" for="orientation"><span>{$translations('sheet.orientation')}</span>
      <select id="orientation" value={settings.orientation} onchange={(event) => model.setSheetSetting('orientation', event.currentTarget.value as SheetSettings['orientation'])}>
        <option value="auto">{$translations('sheet.orientation.auto')}</option>
        <option value="portrait">{$translations('sheet.orientation.portrait')}</option>
        <option value="landscape">{$translations('sheet.orientation.landscape')}</option>
      </select>
    </label>
  {/if}

  <label class="field-row" for="margin"><span>{$translations('sheet.margin')}</span>
    <span class="number-with-unit"><input id="margin" type="number" min="0" max="100" step="0.5" inputmode="decimal" value={settings.marginMm} onchange={(event) => model.setSheetSetting('marginMm', mm(event.currentTarget.value, 0))} /><span>mm</span></span>
  </label>
  <label class="field-row" for="gap"><span>{$translations('sheet.spacing')}</span>
    <span class="number-with-unit"><input id="gap" type="number" min="0" max="50" step="0.5" inputmode="decimal" value={settings.gapMm} onchange={(event) => model.setSheetSetting('gapMm', mm(event.currentTarget.value, 0))} /><span>mm</span></span>
  </label>
  <label class="check-row"><input type="checkbox" aria-describedby="calibration-help" checked={settings.calibration} onchange={(event) => model.setSheetSetting('calibration', event.currentTarget.checked)} />{$translations('sheet.calibration')}</label>
  <p class="field-help" id="calibration-help">{$translations('sheet.calibrationHelp')}</p>
  <label class="field-stack" for="dpi-cap"><span>{$translations('sheet.dpiCap')}</span>
    <select id="dpi-cap" value={String(settings.dpiCap)} onchange={(event) => model.setSheetSetting('dpiCap', Number(event.currentTarget.value) as 300 | 600)}>
      <option value="300">{$translations('sheet.dpiCap.300')}</option>
      <option value="600">{$translations('sheet.dpiCap.600')}</option>
    </select>
  </label>
</section>
