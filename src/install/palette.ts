// INSTALL-PAGE-ONLY color constants. The browser response is a standalone HTML
// document, so it cannot inherit the site's CSS custom properties. Keep its
// literal colors centralized here; this is the narrow token-guard exception.
export const INSTALL_PAGE = {
  bg: '#0A0A0A',
  codeBg: '#101010',
  border: '#2E2E2E',
  text: '#EDEDEB',
  textMuted: '#A9A9A6',
  codeText: '#D6D6D2',
} as const;
