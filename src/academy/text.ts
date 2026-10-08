/** A piece of text in both Academy languages. Kept free of imports so song data and i18n can share it. */
export type Lang = 'hi' | 'en';

export interface Text {
  hi: string;
  en: string;
}

export const isLang = (v: unknown): v is Lang => v === 'hi' || v === 'en';

export const isText = (v: unknown): v is Text =>
  typeof v === 'object' && v !== null && typeof (v as Text).hi === 'string' && typeof (v as Text).en === 'string';
