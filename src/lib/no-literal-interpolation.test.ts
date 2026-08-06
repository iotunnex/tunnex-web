import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ⛔ A `${...}` MARKER IN A NON-TEMPLATE STRING SHIPS AS LITERAL TEXT TO A VISITOR.
 *
 * This is not hypothetical. The 30-day sweep replaced copy inside SINGLE-QUOTED strings with `${TRIAL_
 * LENGTH_NOUN}` — valid in a template literal, inert in a plain string — and it reached production:
 *
 *   "…and your ${TRIAL_LENGTH_NOUN} start the moment your license key is issued."
 *
 * SEVEN occurrences, in `trial.astro` and THREE email templates. The emails were broken too.
 *
 * ⚠ AND THE CHECK THAT MISSED IT IS THE FINDING. The sweep verified the live page by
 * `curl … | grep "30-day"` — which PASSED, because the hero interpolated correctly. A grep for the number
 * answers "does the value appear", not "does the page read correctly", and a broken interpolation two
 * lines below a correct one is invisible to it.
 *
 * ⛔ The snapshot test made it worse rather than catching it: regenerating with `-u` ENSHRINED the literal
 * `${TRIAL_LENGTH_NOUN}` as expected output. An accepted snapshot is an assertion that whatever you just
 * produced is correct.
 *
 * ⭐ So the subject here is the DEFECT SHAPE, not the variable: any `${` inside a quote-delimited string.
 * It would have caught this one and catches the next one, whatever it interpolates.
 */
describe('no literal ${} in shipped strings', () => {
  const SKIP = /node_modules|__snapshots__|\.test\.ts$|no-literal-interpolation/;

  function* walk(dir: string): Generator<string> {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (SKIP.test(p)) continue;
      if (statSync(p).isDirectory()) yield* walk(p);
      else if (/\.(ts|astro|md|mdx)$/.test(name)) yield p;
    }
  }

  it('every ${...} sits inside a template literal', () => {
    const offenders: string[] = [];
    for (const file of walk('src')) {
      // ⛔ TRACK WHETHER WE ARE INSIDE A TEMPLATE LITERAL. Two earlier subjects were wrong and each failed
      // in its own way, which is the lesson:
      //   1. "any quote pair containing ${"  -> 19 false positives: `<svg class="x ${y}">` inside backticks
      //   2. "a ${ with no backtick on THIS line" -> false positives on the INTERIOR lines of multi-line
      //      template literals, where the opening backtick is above.
      // The real subject is the enclosing delimiter, which is state carried across lines.
      let inTemplate = false;
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          const opensOrCloses = (line.match(/`/g) ?? []).length % 2 === 1;
          const liveHere = inTemplate || line.includes('`');
          if (line.includes('${') && !liveHere) {
            offenders.push(`${file}:${i + 1}  ${line.trim().slice(0, 90)}`);
          }
          if (opensOrCloses) inTemplate = !inTemplate;
        });
    }
    expect(
      offenders,
      '⛔ A ${...} MARKER IS INSIDE A QUOTED STRING. It will render as literal text to a visitor — it does ' +
        'not interpolate. Use a template literal (backticks), or `{expr}` in Astro markup.',
    ).toEqual([]);
  });
});
