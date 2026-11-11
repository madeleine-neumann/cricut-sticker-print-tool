import { derived, get, readonly, writable } from 'svelte/store';
import { de, type TranslationKey } from './locales/de.ts';
import { en } from './locales/en.ts';

export type Locale = 'de' | 'en';
export type TranslationParams = Record<string, string | number>;
export type Translator = (key: TranslationKey, params?: TranslationParams) => string;
const storageKey = 'stickerwerkstatt.locale';

export function detectLocale(saved: string | null | undefined, browserLanguage: string | null | undefined): Locale {
  if (saved === 'de' || saved === 'en') return saved;
  return /^de(?:[-_]|$)/i.test(browserLanguage ?? '') ? 'de' : 'en';
}

function initialLocale(): Locale {
  let saved: string | null = null;
  try { saved = globalThis.localStorage?.getItem(storageKey) ?? null; } catch { /* Storage can be disabled. */ }
  return detectLocale(saved, globalThis.navigator?.language);
}

const localeState = writable<Locale>(initialLocale());
export const locale = readonly(localeState);

function translateFor(language: Locale, key: TranslationKey, params: TranslationParams = {}): string {
  const message: string = language === 'de' ? de[key] : en[key];
  return message.replace(/\{([a-zA-Z][\w]*)\}/g, (placeholder, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : placeholder);
}

// Use $translations in Svelte components so text updates when the locale changes.
export const translations = derived(locale, (language): Translator =>
  (key, params) => translateFor(language, key, params));

function syncDocument(language: Locale): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = language;
  document.title = language === 'de' ? de['app.pageTitle'] : en['app.pageTitle'];
}

syncDocument(get(locale));

export function setLocale(next: Locale): void {
  localeState.set(next);
  syncDocument(next);
  try { globalThis.localStorage?.setItem(storageKey, next); } catch { /* Keep the current choice for this page. */ }
}

// For imperative messages; use $translations for reactive text in Svelte components.
export function t(key: TranslationKey, params: TranslationParams = {}): string {
  return get(translations)(key, params);
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(get(locale), options).format(value);
}

export type { TranslationKey };
