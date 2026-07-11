// EMAIL-ONLY color constants — the single place email colors are defined.
// Email clients cannot resolve CSS custom properties, so templates must inline
// literal colors; this file is the narrow token-guard exclusion for that
// (values mirror the light-mode semantic tokens in src/styles/tokens.css).
export const EMAIL = {
  bg: '#f7fafc',
  surface: '#ffffff',
  border: '#d3dee9',
  text: '#132032',
  textMuted: '#4a5c74',
  primary: '#0e7490',
  primaryFg: '#ffffff',
} as const;
