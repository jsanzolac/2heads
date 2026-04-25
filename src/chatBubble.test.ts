import { describe, expect, it } from 'vitest';
import { renderChatBubble } from './chatBubble.js';

describe('renderChatBubble', () => {
  it('renders Claude on the left with a visible background', () => {
    const output = renderChatBubble({
      agent: 'claude',
      index: 1,
      total: 3,
      text: 'A concise answer.',
      columns: 160
    });

    expect(output).toContain('Claude (turn 1 of 3)');
    expect(output).toContain('A concise answer.');
    expect(output).toContain('\u001B[48;2;229;246;244m');
    expect(output).toContain('\u001B[38;2;24;75;73m');
    expect(output.split('\n').some((line) => /^ \u001B/.test(line))).toBe(true);
  });

  it('renders Codex left-aligned and full-width with a distinct background', () => {
    const output = renderChatBubble({
      agent: 'codex',
      index: 2,
      total: 3,
      text: 'A second answer.',
      columns: 160
    });

    expect(output).toContain('Codex (turn 2 of 3)');
    expect(output).toContain('\u001B[48;2;244;240;255m');
    expect(output).toContain('\u001B[38;2;67;50;118m');
    const codexLine = output.split('\n').find((line) => line.includes('Codex (turn 2 of 3)')) ?? '';
    const indent = codexLine.search(/\u001B/);
    expect(indent).toBe(1);
    expect(codexLine.length).toBeGreaterThan(150);
  });

  it('renders recap as a distinct full-width style and normalizes display math', () => {
    const output = renderChatBubble({
      agent: 'claude',
      index: 3,
      total: 3,
      label: 'recap',
      text: 'Final result:\n$$\nx^2 + y^2 = z^2\n$$',
      columns: 80
    });

    expect(output).toContain('Claude recap (final)');
    expect(output).toContain('formula:');
    expect(output).toContain('x^2 + y^2 = z^2');
    expect(output).toContain('\u001B[48;2;252;247;224m');
    expect(output).toContain('\u001B[38;2;88;72;31m');
    const recapLine = output.split('\n').find((line) => line.includes('Claude recap (final)')) ?? '';
    expect(recapLine.length).toBeGreaterThan(70);
  });

  it('formats common Markdown emphasis inside bubbles', () => {
    const output = renderChatBubble({
      agent: 'claude',
      index: 1,
      total: 3,
      text: '# Heading\n- **Bold** and *italic* with `code`\n---',
      columns: 100
    });

    expect(output).toContain('Heading');
    expect(output).toContain('• ');
    expect(output).toContain('\u001B[1mBold\u001B[22m');
    expect(output).toContain('\u001B[3mitalic\u001B[23m');
    expect(output).toContain('\u001B[4mcode\u001B[24m');
    expect(output).toContain('─');
  });

  it('renders Markdown tables as aligned terminal tables', () => {
    const output = renderChatBubble({
      agent: 'claude',
      index: 1,
      total: 3,
      text: [
        '| Concept | Rule |',
        '|---|---|',
        '| Power Rule | d/dx x^n = n x^(n-1) |',
        "| Product Rule | d/dx(fg) = f g' + f' g |"
      ].join('\n'),
      columns: 120
    });

    expect(output).toContain('│ Concept');
    expect(output).toContain('│ Rule');
    expect(output).toContain('├');
    expect(output).toContain('Power Rule');
    expect(output).not.toContain('|---|---|');
  });
});
