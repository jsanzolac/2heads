import { describe, expect, it } from 'vitest';
import { composeRecapPrompt, composeTurnPrompt, formatPriorTurns } from './prompts.js';

describe('composeTurnPrompt', () => {
  it('builds a first-turn prompt for the selected agent', () => {
    const prompt = composeTurnPrompt({
      agent: 'claude',
      originalPrompt: 'Design an API.'
    });

    expect(prompt).toContain('Respond in chat only.');
    expect(prompt).toContain('User prompt:\nDesign an API.');
    expect(prompt).toContain('You are Claude. Answer the user prompt directly.');
  });

  it('builds a seeded handoff prompt without resending the transcript', () => {
    const prompt = composeTurnPrompt({
      agent: 'codex',
      originalPrompt: 'Design an API.',
      context: '--- BEGIN TAGGED FILE: src/api.ts ---\nexport {}\n--- END TAGGED FILE: src/api.ts ---',
      previousAgent: 'claude',
      previousAnswer: 'Use a message queue.\nInclude retries.'
    });

    expect(prompt).toContain('User prompt:\nDesign an API.');
    expect(prompt).toContain('Tagged file context:');
    expect(prompt).toContain('Do not say you cannot open or access a tagged file unless that file is not listed below.');
    expect(prompt).toContain('--- BEGIN TAGGED FILE: src/api.ts ---');
    expect(prompt).not.toContain('Conversation so far:');
    expect(prompt).toContain('Claude said this:\n\nUse a message queue.\nInclude retries.');
    expect(prompt).toContain('Push back on the previous answer before you build on it.');
    expect(prompt).toContain('What do you think?');
  });

  it('builds a lightweight continuation handoff without the original prompt', () => {
    const prompt = composeTurnPrompt({
      agent: 'claude',
      originalPrompt: 'Design an API.',
      context: '--- BEGIN TAGGED FILE: src/api.ts ---\nexport {}\n--- END TAGGED FILE: src/api.ts ---',
      previousAgent: 'codex',
      previousAnswer: 'Use retries.',
      includeOriginalPrompt: false
    });

    expect(prompt).not.toContain('User prompt:');
    expect(prompt).not.toContain('Tagged file context:');
    expect(prompt).toContain('Codex said this:\n\nUse retries.');
    expect(prompt).toContain('Look for weak assumptions, missing edge cases, factual or logical errors');
    expect(prompt).toContain('What do you think?');
  });
});

describe('formatPriorTurns', () => {
  it('labels each prior answer', () => {
    expect(
      formatPriorTurns([
        { agent: 'claude', answer: 'First' },
        { agent: 'codex', answer: 'Second' }
      ])
    ).toBe('[1] Claude:\nFirst\n\n[2] Codex:\nSecond');
  });
});

describe('composeRecapPrompt', () => {
  it('asks the first agent for a detailed final recap of the full discussion', () => {
    const prompt = composeRecapPrompt({
      agent: 'claude',
      originalPrompt: 'Pick an architecture.',
      priorTurns: [
        { agent: 'claude', answer: 'Use workers.' },
        { agent: 'codex', answer: 'Add retries.' }
      ]
    });

    expect(prompt).toContain('Full back-and-forth:');
    expect(prompt).toContain('[1] Claude:\nUse workers.');
    expect(prompt).toContain('[2] Codex:\nAdd retries.');
    expect(prompt).toContain('Make a final recap of the full back-and-forth.');
    expect(prompt).toContain('Do not lose details.');
  });
});
