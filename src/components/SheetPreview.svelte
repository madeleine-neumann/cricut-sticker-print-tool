<script lang="ts">
  import { drawCalibration, drawScissors, drawSheet, geometryFor } from '../lib/export.ts';
  import { locale, translations } from '../lib/i18n.ts';
  import { formatNotice } from '../lib/sheets.ts';
  import type { WorkspaceState } from '../lib/state.svelte.ts';

  let { state: model }: { state: WorkspaceState } = $props();
  let canvas = $state<HTMLCanvasElement | undefined>(undefined);
  let showCut = $state(true);
  const format = $derived.by(() => { const language = $locale; return (value: number) => new Intl.NumberFormat(language, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value); });
  const plan = $derived(model.sheet?.ok ? model.sheet.plan : null);
  const geo = $derived(plan ? geometryFor(plan, plan.layout, 900 / (Math.max(plan.layout.pageWMm, plan.layout.pageHMm) / 25.4)) : null);
  const summary = $derived(plan ? plan.summary.map((n) => formatNotice(n, $translations, format)).join(' ') : '');
  const warnings = $derived(plan ? plan.warnings.map((n) => formatNotice(n, $translations, format)) : []);

  $effect(() => {
    if (!canvas || !plan || !geo) return;
    const page = drawSheet(geo, true, plan.entries);
    drawScissors(page, plan.layout);
    drawCalibration(page, plan.layout);
    canvas.width = geo.pageW; canvas.height = geo.pageH;
    canvas.getContext('2d')?.drawImage(page, 0, 0);
  });
</script>

<section class="preview-panel" aria-labelledby="sheet-preview-title">
  <div class="preview-header">
    <div><p class="eyebrow">{$translations('sheet.preview')}</p><h3 id="sheet-preview-title">{plan ? $translations(`sheet.paper.${plan.paperKey}`) : ''}</h3></div>
    <div class="preview-toggles"><label><input type="checkbox" bind:checked={showCut} />{$translations('cut.cutLine')}</label></div>
  </div>
  <div class="preview-stage sheet-stage" aria-busy={model.sheetBusy}>
    {#if model.sheetBusy}<p class="preview-busy">{$translations('status.sheetCalculating')}</p>{/if}
    {#if plan && geo}
      <div class="sheet-page" role="img" aria-label={$translations('sheet.previewImage', { summary })} style:aspect-ratio={`${geo.pageW} / ${geo.pageH}`} style:width={`min(100%, ${Math.round(640 * geo.pageW / geo.pageH)}px)`}>
        <canvas bind:this={canvas} aria-hidden="true"></canvas>
        {#if showCut}<svg class="cut-overlay" viewBox={`0 0 ${geo.pageW} ${geo.pageH}`} preserveAspectRatio="none" aria-hidden="true"><path d={geo.paths.join('')} /></svg>{/if}
      </div>
    {/if}
  </div>
  {#if model.sheet && !model.sheet.ok}
    <p class="quality-warning" role="alert">{formatNotice(model.sheet.error, $translations, format)}</p>
  {:else if plan}
    <p class="sheet-summary">{summary}</p>
    {#each warnings as warning}<p class="quality-warning">{warning}</p>{/each}
  {/if}
</section>
