<script lang="ts">
  import { translations } from '../lib/i18n.ts';
  import type { WorkspaceState } from '../lib/state.svelte.ts';
  import CutControls from './CutControls.svelte';

  let { state: model }: { state: WorkspaceState } = $props();
</script>

<section class="cut-motifs" aria-labelledby="cut-controls-title">
  <h3 id="cut-controls-title">{$translations('cut.title')}</h3>
  {#each model.collection.items as motif, index (motif.id)}
    <!-- Opening a motif shows it in the preview; several may stay open. -->
    <details class="cut-motif" class:selected={model.collection.selectedId === motif.id} open={index === 0} ontoggle={(event) => { if (event.currentTarget.open && model.collection.selectedId !== motif.id) model.select(motif.id); }}>
      <summary>
        {#if motif.thumbnail}<img src={motif.thumbnail} alt="" width="36" height="36" class:mirrored={motif.mirrored} />{/if}
        <span><strong>{motif.name}</strong>{#if motif.heightMm === null}<small class="needs-height">{$translations('upload.heightMissing')}</small>{/if}</span>
      </summary>
      <CutControls state={model} {motif} />
    </details>
  {/each}
</section>
