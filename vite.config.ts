import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  base: '/cricut-sticker-print-tool/',
  plugins: [svelte()],
  build: { outDir: 'dist' },
});
