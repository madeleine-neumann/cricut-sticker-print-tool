<script lang="ts">
  import { untrack } from 'svelte';
  import { locale, setLocale, translations, type TranslationKey } from './lib/i18n.ts';
  import { workspace } from './lib/state.svelte.ts';
  import MotifList from './components/MotifList.svelte';
  import CutMotifs from './components/CutMotifs.svelte';
  import StickerPreview from './components/StickerPreview.svelte';
  import SheetControls from './components/SheetControls.svelte';
  import SheetPreview from './components/SheetPreview.svelte';
  import ExportActions from './components/ExportActions.svelte';

  type Step = 0 | 1 | 2;
  let activeStep = $state<Step>(0);

  const steps: TranslationKey[] = ['app.step.motifs', 'app.step.cut', 'app.step.sheet'];
  const titles: TranslationKey[] = ['app.emptyTitle', 'app.cutTitle', 'app.sheetTitle'];
  // Only the step change may trigger planning; untrack keeps the plan's own state writes from re-running this.
  $effect(() => { const active = activeStep === 2; untrack(() => workspace.setSheetActive(active)); });
</script>

<a class="skip-link" href="#main-content">{$translations('app.skipLink')}</a>
<div class="site-shell">
  <header class="site-header">
    <div class="brand">
      <span class="brand-mark" aria-hidden="true"></span>
      <div>
        <p class="eyebrow">9elements</p>
        <h1>{$translations('app.title')}</h1>
      </div>
    </div>
    <div class="language-control" role="group" aria-label={$translations('app.languageLabel')}>
      <button type="button" class:current={$locale === 'de'} aria-pressed={$locale === 'de'} onclick={() => setLocale('de')}>DE</button>
      <button type="button" class:current={$locale === 'en'} aria-pressed={$locale === 'en'} onclick={() => setLocale('en')}>EN</button>
    </div>
  </header>

  <main id="main-content">
    <p class="subtitle">{$translations('app.subtitle')}</p>
    <nav class="steps" aria-label={$translations('app.stepsLabel')}>
      {#each steps as step, index}
        <button type="button" class:active={activeStep === index} aria-current={activeStep === index ? 'step' : undefined} onclick={() => activeStep = index as Step}>
          <span class="step-number">{String(index + 1).padStart(2, '0')}</span>
          <span>{$translations(step)}</span>
        </button>
      {/each}
    </nav>
    <section class="workspace" aria-labelledby="workspace-title">
      <p class="eyebrow">{$translations('app.stepCount', { current: String(activeStep + 1).padStart(2, '0'), total: '03' })}</p>
      <h2 id="workspace-title">{$translations(titles[activeStep])}</h2>
      {#if workspace.errors.length || workspace.error || workspace.selected?.noTransparency}
        <div class="workspace-messages" role="alert">
          {#each workspace.errors as issue}<p>{$translations(issue.key, issue.params)}</p>{/each}
          {#if workspace.error}<p>{$translations(workspace.error)}</p>{/if}
          {#if workspace.selected?.noTransparency}<p>{$translations('error.noTransparency', { name: workspace.selected.name })}</p>{/if}
        </div>
      {/if}
      {#if !workspace.collection.items.length}
        <div class="empty-workspace"><MotifList state={workspace} /></div>
      {:else if activeStep === 2}
        <div class="workspace-grid">
          <div class="control-column"><SheetControls state={workspace} /><ExportActions state={workspace} /></div>
          <SheetPreview state={workspace} />
        </div>
      {:else}
        <div class="workspace-grid">
          {#if activeStep === 0}<MotifList state={workspace} />{:else}<CutMotifs state={workspace} />{/if}
          <StickerPreview state={workspace} />
        </div>
      {/if}
      <p class="visually-hidden" role="status" aria-live="polite">{workspace.processing ? $translations('status.calculating') : workspace.result ? $translations('status.cutReady') : ''}</p>
    </section>

    <details class="guide">
      <summary>{$translations('app.help')}</summary>
      <div class="guide-content">
        <h2>{$translations('guide.title')}</h2>
        <p>{$translations('guide.intro')}</p>
        <section><h3>{$translations('guide.uploadTitle')}</h3><p>{$translations('guide.uploadBody')}</p></section>
        <section><h3>{$translations('guide.cutTitle')}</h3><p>{$translations('guide.cutBody')}</p></section>
        <section><h3>{$translations('guide.sheetTitle')}</h3><p>{$translations('guide.sheetBody')}</p></section>
        <section><h3>{$translations('guide.exportTitle')}</h3><p>{$translations('guide.exportBody')}</p></section>
        <section><h3>{$translations('guide.cricutTitle')}</h3><p>{$translations('guide.cricutBody')}</p></section>
      </div>
    </details>
  </main>
</div>
