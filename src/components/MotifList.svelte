<script lang="ts">
  import { translations } from '../lib/i18n.ts';
  import type { WorkspaceState } from '../lib/state.svelte.ts';

  let { state: model }: { state: WorkspaceState } = $props();
  let dragging = $state(false);

  function drop(event: DragEvent) {
    event.preventDefault();
    dragging = false;
    if (event.dataTransfer?.files) void model.load(event.dataTransfer.files);
  }
</script>

<section class="motif-panel" aria-labelledby="motif-list-title">
  <h3 id="motif-list-title">{$translations('upload.title')}</h3>
  <label class:dragging class="dropzone" ondragover={(event) => { event.preventDefault(); dragging = true; }} ondragleave={() => dragging = false} ondrop={drop}>
    <span class="drop-label">{$translations('upload.dropzone')}</span>
    <span class="upload-button">{$translations('upload.chooseFiles')}</span>
    <input type="file" accept="image/png,image/webp,.png,.webp" multiple onchange={(event) => { if (event.currentTarget.files) void model.load(event.currentTarget.files); event.currentTarget.value = ''; }} />
  </label>
  <p class="field-help">{$translations('upload.hint')}</p>

  {#if model.collection.items.length}
    <ul class="motif-list">
      {#each model.collection.items as motif (motif.id)}
        <li class:selected={model.collection.selectedId === motif.id}>
          <button type="button" class="motif-pick" aria-pressed={model.collection.selectedId === motif.id} aria-label={$translations('upload.select', { name: motif.name })} onclick={() => model.select(motif.id)}>
            {#if motif.thumbnail}<img src={motif.thumbnail} alt="" width="48" height="48" />{/if}
            <span><strong>{motif.name}</strong>{#if motif.heightMm === null}<small class="needs-height">{$translations('upload.heightMissing')}</small>{/if}</span>
          </button>
          <button type="button" class="remove-button" aria-label={$translations('upload.remove', { name: motif.name })} title={$translations('upload.remove', { name: motif.name })} onclick={() => model.remove(motif.id)}>×</button>
          <label class="copies-field">
            <span>{$translations('upload.height')}</span>
            <span class="number-with-unit"><input type="number" min="0.5" max="1000" step="0.1" inputmode="decimal" required value={motif.heightMm ?? ''} placeholder={motif.suggestedHeightMm ? motif.suggestedHeightMm.toFixed(1) : ''} aria-label={$translations('upload.heightFor', { name: motif.name })} aria-describedby={motif.suggestedHeightMm ? `height-hint-${motif.id}` : undefined} onchange={(event) => model.setHeight(motif.id, event.currentTarget.value === '' ? '' : Number(event.currentTarget.value))} /><span>mm</span></span>
          </label>
          {#if motif.suggestedHeightMm && motif.heightMm === null}<p class="field-help height-hint" id={`height-hint-${motif.id}`}>{$translations('upload.heightSuggested', { height: motif.suggestedHeightMm.toFixed(1) })}</p>{/if}
          <label class="copies-field">
            <span>{$translations('upload.copies')}</span>
            <input type="number" min="1" step="1" inputmode="numeric" value={motif.copies} placeholder={$translations('upload.fill')} aria-label={$translations('upload.copiesFor', { name: motif.name })} oninput={(event) => model.setCopies(motif.id, event.currentTarget.value === '' ? '' : Number(event.currentTarget.value))} />
          </label>
        </li>
      {/each}
    </ul>
    <p class="field-help">{$translations('upload.fillHelp')}</p>
  {/if}
</section>
