// EMAIL-ONLY color constants — the single place email colors are defined.
// Email clients cannot resolve CSS custom properties, so templates must inline
// literal colors; this file is the narrow token-guard exclusion for that
// (values mirror the light-mode semantic tokens in src/styles/tokens.css).
export const EMAIL = {
  bg: '#0A0A0A',
  surface: '#141414',
  border: '#2E2E2E',
  text: '#EDEDEB',
  textMuted: '#A9A9A6',
  primary: '#B03A45',
  primaryFg: '#FFFFFF',
  white: '#FFFFFF',
} as const;
