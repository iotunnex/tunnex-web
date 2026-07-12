// psl 1.15 ships types that its package.json "exports" map hides from TS —
// minimal local declaration of the surface this repo uses.
declare module 'psl' {
  interface ParsedDomain {
    error?: undefined;
    input: string;
    tld: string | null;
    sld: string | null;
    domain: string | null;
    subdomain: string | null;
    listed: boolean;
  }
  interface ParseError {
    error: { code: string; message: string };
    input: string;
  }
  function parse(host: string): ParsedDomain | ParseError;
  function get(host: string): string | null;
  function isValid(host: string): boolean;
  const psl: {
    parse: typeof parse;
    get: typeof get;
    isValid: typeof isValid;
  };
  export default psl;
  export { parse, get, isValid };
}
