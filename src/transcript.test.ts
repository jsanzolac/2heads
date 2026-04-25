import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { SessionStore } from './transcript.js';

describe('SessionStore', () => {
  it('writes turns to JSON and Markdown transcript files', async () => {
    const dir = await mkdtemp(join(tmpdir(), '2heads-test-'));
    try {
      const store = await SessionStore.create(dir, {
        sessionName: 'test',
        workdir: dir,
        rounds: 1,
        firstAgent: 'claude'
      });

      await store.recordTurn({
        id: 'turn-1',
        conversationId: 'conversation-1',
        round: 1,
        index: 1,
        agent: 'claude',
        userPrompt: 'Hello?',
        prompt: 'prompt sent',
        answer: 'Answer.',
        startedAt: '2026-04-25T00:00:00.000Z',
        finishedAt: '2026-04-25T00:00:01.000Z',
        exitCode: 0
      });

      const turns = JSON.parse(await readFile(store.turnsPath, 'utf8')) as unknown[];
      const markdown = await readFile(store.transcriptPath, 'utf8');

      expect(turns).toHaveLength(1);
      expect(markdown).toContain('## 1. Claude - round 1');
      expect(markdown).toContain('Answer.');
      expect(store.lastAnswer()).toBe('Answer.');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
