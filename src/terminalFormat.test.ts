import { describe, expect, it } from 'vitest';
import { formatMathForTerminal } from './terminalFormat.js';

describe('formatMathForTerminal', () => {
  it('keeps inline math visible with delimiters', () => {
    const output = formatMathForTerminal('Use $x^2 + y^2 = z^2$ here.');

    expect(output).toContain('$x^2 + y^2 = z^2$');
  });

  it('formats display math blocks as terminal formula blocks', () => {
    const output = formatMathForTerminal('Then:\n$$\na^2 + b^2 = c^2\n$$\nDone.');

    expect(output).toContain('formula');
    expect(output).toContain('  a^2 + b^2 = c^2');
  });
});
