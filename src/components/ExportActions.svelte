<script lang="ts">
  import { pdfSupported } from '../lib/export.ts';
  import { locale, translations } from '../lib/i18n.ts';
  import { alignmentPage, formatNotice } from '../lib/sheets.ts';
  import type { WorkspaceState } from '../lib/state.svelte.ts';

  let { state: model }: { state: WorkspaceState } = $props();
  const ready = $derived(!!model.sheet?.ok && !model.sheetBusy);
  const stickerReady = $derived(!!model.result && !model.processing);
  const canPdf = pdfSupported();
  const format = $derived.by(() => { const language = $locale; return (value: number) => new Intl.NumberFormat(language).format(value); });
</script>

<section class="export-panel" aria-labelledby="export-title">
  <header class="export-header">
    <h3 id="export-title">{$translations('export.title')}</h3>
    {#if model.sheetSettings.mat}<p class="export-machine">{$translations('export.forMachine', { machine: $translations(`sheet.machine.${model.sheetSettings.machine}`), mat: $translations(`sheet.mat.${model.sheetSettings.mat}`) })}</p>{/if}
    {#if !ready}<p class="export-waiting" role="status">{$translations('export.disabled')}</p>{/if}
  </header>

  <div class="export-cards">
    <section class="export-card" aria-labelledby="export-print-title">
      <h4 id="export-print-title">{$translations('export.print')}</h4>
      <p class="field-help">{$translations('export.printHelp')}</p>
      <label class="field-stack" for="dpi-cap"><span>{$translations('sheet.dpiCap')}</span>
        <select id="dpi-cap" value={String(model.sheetSettings.dpiCap)} onchange={(event) => model.setSheetSetting('dpiCap', Number(event.currentTarget.value) as 300 | 600)}>
          <option value="300">{$translations('sheet.dpiCap.300')}</option>
          <option value="600">{$translations('sheet.dpiCap.600')}</option>
        </select>
      </label>
      <div class="export-buttons">
        <button type="button" class="primary-action" data-sheet-export disabled={!ready} onclick={() => model.exportSheet('print')}>{$translations('export.printBrowser')}</button>
        {#if canPdf}<button type="button" data-sheet-export disabled={!ready} onclick={() => model.exportSheet('pdf')}>{$translations('export.printPdf')}</button>{/if}
        <button type="button" data-sheet-export disabled={!ready} onclick={() => model.exportSheet('png')}>{$translations('export.printPng')}</button>
      </div>
      {#if !canPdf}<p class="field-help">{$translations('export.pdfUnsupported')}</p>{/if}
    </section>

    <section class="export-card" aria-labelledby="export-cut-title">
      <h4 id="export-cut-title">{$translations('export.cut')}</h4>
      <p class="field-help">{$translations('export.cutHelp')}</p>
      <label class="check-row"><input type="checkbox" checked={model.sheetSettings.pageOutline} onchange={(event) => model.setSheetSetting('pageOutline', event.currentTarget.checked)} />{$translations('export.pageOutline')}</label>
      <div class="export-buttons">
        <button type="button" class="primary-action" data-sheet-export disabled={!ready} onclick={() => model.exportSheet('svg')}>{$translations('export.cutSvg')}</button>
        <button type="button" data-sheet-export disabled={!ready} onclick={() => model.exportSheet('both')}>{$translations('export.combinedSvg')}</button>
      </div>
    </section>

    <section class="export-card" aria-labelledby="export-single-title">
      <h4 id="export-single-title">{$translations('export.single')}</h4>
      {#if model.selected}<p class="export-subject">{model.selected.name}</p>{/if}
      <p class="field-help">{$translations('export.singleHelp')}</p>
      <div class="export-buttons">
        <button type="button" disabled={!stickerReady} onclick={() => model.exportSticker('png')}>{$translations('export.singlePng')}</button>
        <button type="button" disabled={!stickerReady} onclick={() => model.exportSticker('svg')}>{$translations('export.singleSvg')}</button>
        <button type="button" disabled={!stickerReady} onclick={() => model.exportSticker('both')}>{$translations('export.singleCombined')}</button>
      </div>
    </section>

    <section class="export-card export-card-wide alignment" aria-labelledby="export-alignment-title">
      <h4 id="export-alignment-title">{$translations('export.alignment')}</h4>
      {#if alignmentPage(model.sheetSettings)}
        <div class="alignment-body">
        <ol class="alignment-steps">
          <li>{$translations('export.alignmentStep1')}</li>
          <li>{$translations('export.alignmentStep2')}</li>
          <li>{$translations('export.alignmentStep3')}</li>
        </ol>
        <div class="alignment-values">
        <div class="offset-fields">
        <label class="field-stack" for="offset-x"><span>{$translations('export.offsetX')}</span>
          <span class="number-with-unit"><input id="offset-x" type="number" min="-15" max="15" step="0.1" inputmode="decimal" value={model.sheetSettings.offsetXMm} onchange={(event) => model.setOffset('offsetXMm', Number(event.currentTarget.value))} /><span>mm</span></span>
        </label>
        <label class="field-stack" for="offset-y"><span>{$translations('export.offsetY')}</span>
          <span class="number-with-unit"><input id="offset-y" type="number" min="-15" max="15" step="0.1" inputmode="decimal" value={model.sheetSettings.offsetYMm} onchange={(event) => model.setOffset('offsetYMm', Number(event.currentTarget.value))} /><span>mm</span></span>
        </label>
        </div>
        <p class="field-help">{$translations('export.offsetHelp')}</p>
        <div class="export-buttons">
          <button type="button" onclick={() => model.exportAlignment('pdf')}>{$translations('export.alignmentPdf')}</button>
          <button type="button" onclick={() => model.exportAlignment('svg')}>{$translations('export.alignmentSvg')}</button>
        </div>
        </div>
        </div>
      {:else}
        <p class="field-help">{$translations('export.alignmentUnavailable')}</p>
      {/if}
    </section>
  </div>

  <div class="export-status" role="status" aria-live="polite">
    {#each model.exportNotices as notice}<p>{formatNotice(notice, $translations, format)}</p>{/each}
  </div>
</section>
