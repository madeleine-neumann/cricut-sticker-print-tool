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
  <h3 id="export-title">{$translations('export.title')}</h3>
  {#if model.sheetSettings.mat}<p class="export-machine">{$translations('export.forMachine', { machine: $translations(`sheet.machine.${model.sheetSettings.machine}`), mat: $translations(`sheet.mat.${model.sheetSettings.mat}`) })}</p>{/if}
  {#if !ready}<p class="field-help">{$translations('export.disabled')}</p>{/if}

  <div class="export-group" role="group" aria-labelledby="export-print-title" aria-describedby="export-print-help">
    <h4 id="export-print-title">{$translations('export.print')}</h4>
    <p class="field-help" id="export-print-help">{$translations('export.printHelp')}</p>
    <div class="export-buttons">
      <button type="button" class="primary-action" disabled={!ready} onclick={() => model.exportSheet('print')}>{$translations('export.printBrowser')}</button>
      {#if canPdf}<button type="button" disabled={!ready} onclick={() => model.exportSheet('pdf')}>{$translations('export.printPdf')}</button>{/if}
      <button type="button" disabled={!ready} onclick={() => model.exportSheet('png')}>{$translations('export.printPng')}</button>
    </div>
    {#if !canPdf}<p class="field-help">{$translations('export.pdfUnsupported')}</p>{/if}
  </div>

  <div class="export-group" role="group" aria-labelledby="export-cut-title" aria-describedby="export-cut-help">
    <h4 id="export-cut-title">{$translations('export.cut')}</h4>
    <p class="field-help" id="export-cut-help">{$translations('export.cutHelp')}</p>
    <label class="check-row"><input type="checkbox" checked={model.sheetSettings.pageOutline} onchange={(event) => model.setSheetSetting('pageOutline', event.currentTarget.checked)} />{$translations('export.pageOutline')}</label>
    <div class="export-buttons">
      <button type="button" disabled={!ready} onclick={() => model.exportSheet('svg')}>{$translations('export.cutSvg')}</button>
      <button type="button" disabled={!ready} onclick={() => model.exportSheet('both')}>{$translations('export.combinedSvg')}</button>
    </div>
  </div>

  <details class="export-group single-export alignment">
    <summary>{$translations('export.alignment')}</summary>
    {#if alignmentPage(model.sheetSettings)}
      <ol class="alignment-steps">
        <li>{$translations('export.alignmentStep1')}</li>
        <li>{$translations('export.alignmentStep2')}</li>
        <li>{$translations('export.alignmentStep3')}</li>
      </ol>
      <div class="export-buttons">
        <button type="button" onclick={() => model.exportAlignment('pdf')}>{$translations('export.alignmentPdf')}</button>
        <button type="button" onclick={() => model.exportAlignment('svg')}>{$translations('export.alignmentSvg')}</button>
      </div>
      <label class="field-row" for="offset-x"><span>{$translations('export.offsetX')}</span>
        <span class="number-with-unit"><input id="offset-x" type="number" min="-15" max="15" step="0.1" inputmode="decimal" value={model.sheetSettings.offsetXMm} onchange={(event) => model.setOffset('offsetXMm', Number(event.currentTarget.value))} /><span>mm</span></span>
      </label>
      <label class="field-row" for="offset-y"><span>{$translations('export.offsetY')}</span>
        <span class="number-with-unit"><input id="offset-y" type="number" min="-15" max="15" step="0.1" inputmode="decimal" value={model.sheetSettings.offsetYMm} onchange={(event) => model.setOffset('offsetYMm', Number(event.currentTarget.value))} /><span>mm</span></span>
      </label>
      <p class="field-help">{$translations('export.offsetHelp')}</p>
    {:else}
      <p class="field-help">{$translations('export.alignmentUnavailable')}</p>
    {/if}
  </details>

  <details class="export-group single-export">
    <summary>{$translations('export.single')}{model.selected ? `: ${model.selected.name}` : ''}</summary>
    <p class="field-help">{$translations('export.singleHelp')}</p>
    <div class="export-buttons">
      <button type="button" disabled={!stickerReady} onclick={() => model.exportSticker('png')}>{$translations('export.singlePng')}</button>
      <button type="button" disabled={!stickerReady} onclick={() => model.exportSticker('svg')}>{$translations('export.singleSvg')}</button>
      <button type="button" disabled={!stickerReady} onclick={() => model.exportSticker('both')}>{$translations('export.singleCombined')}</button>
    </div>
  </details>

  <div class="export-status" role="status" aria-live="polite">
    {#each model.exportNotices as notice}<p>{formatNotice(notice, $translations, format)}</p>{/each}
  </div>
</section>
