<script lang="ts">
  import { pathData } from '../lib/engine/index.js';
  import { locale, translations } from '../lib/i18n.ts';
  import type { WorkspaceState } from '../lib/state.svelte.ts';

  let { state: model }: { state: WorkspaceState } = $props();
  let canvas = $state<HTMLCanvasElement | undefined>(undefined);
  let showOriginal = $state(false);
  let showCut = $state(true);
  let paperBackground = $state(false);
  const fmt = $derived.by(() => {
    const language = $locale;
    return (value: number, digits = 1) => new Intl.NumberFormat(language, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
  });

  $effect(() => {
    const result = model.result;
    const selected = model.selected;
    if (!canvas || !result || !selected) return;
    canvas.width = result.res.width;
    canvas.height = result.res.height;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (showOriginal) {
      const source = document.createElement('canvas');
      source.width = selected.width;
      source.height = selected.height;
      source.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(selected.rgba), selected.width, selected.height), 0, 0);
      context.drawImage(source, result.res.pad, result.res.pad);
    } else context.putImageData(new ImageData(new Uint8ClampedArray(result.res.rgba), result.res.width, result.res.height), 0, 0);
  });
</script>

<section class="preview-panel" aria-labelledby="preview-title">
  <div class="preview-header">
    <div><p class="eyebrow">{$translations('upload.preview')}</p><h3 id="preview-title">{model.selected?.name}</h3></div>
    <div class="preview-toggles" role="group" aria-label={$translations('cut.previewOptions')}>
      <label><input type="checkbox" bind:checked={showOriginal} />{$translations('cut.original')}</label>
      <label><input type="checkbox" bind:checked={showCut} />{$translations('cut.cutLine')}</label>
      <label><input type="checkbox" bind:checked={paperBackground} />{$translations('cut.paperBackground')}</label>
    </div>
  </div>
  <div class:paper={paperBackground} class="preview-stage">
    {#if model.processing}<p class="preview-busy" role="status">{$translations('status.calculating')}</p>{/if}
    {#if !model.processing && model.selected && model.selected.heightMm === null}<p class="preview-empty">{$translations('cut.needsHeight', { name: model.selected.name })}</p>{/if}
    {#if model.result}
      <div class="preview-art" role="img" aria-label={$translations('cut.previewImage', { name: model.selected?.name ?? '' })} style:aspect-ratio={`${model.result.res.width} / ${model.result.res.height}`} style:width={`min(100%, ${Math.min(510, 510 * model.result.res.width / model.result.res.height)}px)`}>
        <canvas bind:this={canvas} aria-hidden="true"></canvas>
        {#if showCut}<svg class="cut-overlay" viewBox={`0 0 ${model.result.res.width} ${model.result.res.height}`} preserveAspectRatio="none" aria-hidden="true"><path d={pathData(model.result.loops, 1)} /></svg>{/if}
      </div>
    {/if}
  </div>
  {#if model.result}
    {@const result = model.result}
    <dl class="preview-stats">
      <div><dt>{$translations('cut.artworkSize')}</dt><dd>{fmt(result.bbox.w / result.dpi * 25.4)} × {fmt(result.bbox.h / result.dpi * 25.4)} mm</dd></div>
      <div><dt>{$translations('cut.printSize')}</dt><dd>{fmt((result.res.bbox.x1 - result.res.bbox.x0) / result.dpi * 25.4)} × {fmt((result.res.bbox.y1 - result.res.bbox.y0) / result.dpi * 25.4)} mm</dd></div>
      <div><dt>{$translations('export.dpi')}</dt><dd>{fmt(result.dpi, 0)} dpi · {result.res.width} × {result.res.height} px</dd></div>
      <div><dt>{$translations('cut.paths')}</dt><dd>{result.loops.length}</dd></div>
    </dl>
    {#if result.dpi < 150}<p class="quality-warning" role="status">{$translations('cut.lowResolution')}</p>{/if}
  {/if}
</section>
