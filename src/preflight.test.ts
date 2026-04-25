import { describe, expect, it } from 'vitest';
import { checkPreflight } from './preflight.js';

describe('checkPreflight', () => {
  it('reports missing commands with install guidance for tmux', async () => {
    const result = await checkPreflight({
      commands: ['tmux', 'codex'],
      exists: async (command) => command === 'codex'
    });

    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(['tmux']);
    expect(result.messages[0]).toContain('brew install tmux');
  });

  it('passes when every command exists', async () => {
    const result = await checkPreflight({
      commands: ['tmux', 'codex'],
      exists: async () => true
    });

    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
  });
});
