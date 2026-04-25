import { describe, expect, it, vi } from 'vitest';
import { runDebate } from './orchestrator.js';
import type { AgentName, TurnResult, WorkerEvent } from './types.js';
import type { WorkerClient } from './workerClient.js';
import type { SessionStore } from './transcript.js';

describe('runDebate', () => {
  it('runs one fixed round plus a final recap by the first agent', async () => {
    const prompts: Record<AgentName, string[]> = {
      claude: [],
      codex: []
    };

    const clients = {
      claude: fakeClient('claude', ['Claude answer'], prompts),
      codex: fakeClient('codex', ['Codex answer'], prompts)
    };
    const recapClient = fakeClient('claude', ['Claude recap'], prompts);

    const recordEvent = vi.fn(async () => undefined);
    const recordTurn = vi.fn(async () => undefined);
    const turnStart = vi.fn();
    const deltas: string[] = [];

    const turns = await runDebate({
      userPrompt: 'Compare these options.',
      rounds: 1,
      firstAgent: 'claude',
      clients,
      recapClient,
      transcript: { recordEvent, recordTurn } as unknown as SessionStore,
      timeoutMs: 1000,
      pollMs: 1,
      output: {
        turnStart,
        delta: (text) => {
          deltas.push(text);
        },
        diagnostic: vi.fn(),
        turnEnd: vi.fn()
      }
    });

    expect(turns).toEqual([
      { agent: 'claude', answer: 'Claude answer' },
      { agent: 'codex', answer: 'Codex answer' },
      { agent: 'claude', answer: 'Claude recap' }
    ]);
    expect(prompts.claude[0]).toContain('Answer the user prompt directly');
    expect(prompts.codex[0]).toContain('Claude said this:\n\nClaude answer');
    expect(prompts.codex[0]).toContain('Push back on the previous answer before you build on it.');
    expect(prompts.claude[1]).toContain('Full back-and-forth:');
    expect(prompts.claude[1]).toContain('[2] Codex:\nCodex answer');
    expect(prompts.claude[1]).toContain('Do not lose details.');
    expect(turnStart).toHaveBeenLastCalledWith('claude', 3, 3, 'recap');
    expect(recordEvent).toHaveBeenCalledTimes(3);
    expect(recordTurn).toHaveBeenCalledTimes(3);
    expect(deltas.join('')).toBe('Claude answerCodex answerClaude recap');
  });

  it('does not resend the whole transcript on later handoffs', async () => {
    const prompts: Record<AgentName, string[]> = {
      claude: [],
      codex: []
    };

    const clients = {
      claude: fakeClient('claude', ['Claude answer 1', 'Claude answer 2'], prompts),
      codex: fakeClient('codex', ['Codex answer 1', 'Codex answer 2'], prompts)
    };
    const recapClient = fakeClient('claude', ['Claude recap'], prompts);

    await runDebate({
      userPrompt: 'Compare these options.',
      rounds: 2,
      firstAgent: 'claude',
      clients,
      recapClient,
      transcript: {
        recordEvent: vi.fn(async () => undefined),
        recordTurn: vi.fn(async () => undefined)
      } as unknown as SessionStore,
      timeoutMs: 1000,
      pollMs: 1,
      output: {
        turnStart: vi.fn(),
        delta: vi.fn(),
        diagnostic: vi.fn(),
        turnEnd: vi.fn()
      }
    });

    expect(prompts.claude[0]).toContain('User prompt:\nCompare these options.');
    expect(prompts.codex[0]).toContain('User prompt:\nCompare these options.');
    expect(prompts.claude[1]).not.toContain('User prompt:');
    expect(prompts.claude[1]).not.toContain('Conversation so far:');
    expect(prompts.claude[1]).toContain('Codex said this:\n\nCodex answer 1');
    expect(prompts.claude[1]).toContain('Push back on the previous answer before you build on it.');
    expect(prompts.codex[1]).not.toContain('User prompt:');
    expect(prompts.codex[1]).not.toContain('Conversation so far:');
    expect(prompts.codex[1]).toContain('Claude said this:\n\nClaude answer 2');
    expect(prompts.codex[1]).toContain('Push back on the previous answer before you build on it.');
  });
});

function fakeClient(
  agent: AgentName,
  answers: string[],
  prompts: Record<AgentName, string[]>
): WorkerClient {
  let callIndex = 0;

  return {
    agent,
    runTurn: async (options: {
      prompt: string;
      agent?: AgentName;
      onEvent: (event: WorkerEvent) => Promise<void>;
    }): Promise<TurnResult> => {
      const requestAgent = options.agent ?? agent;
      const answer = answers[callIndex] ?? answers.at(-1) ?? '';
      callIndex += 1;
      prompts[requestAgent].push(options.prompt);
      await options.onEvent({
        type: 'delta',
        turnId: `${requestAgent}-1`,
        agent: requestAgent,
        timestamp: '2026-04-25T00:00:00.000Z',
        text: answer
      });

      return {
        id: `${requestAgent}-1`,
        agent: requestAgent,
        answer,
        startedAt: '2026-04-25T00:00:00.000Z',
        finishedAt: '2026-04-25T00:00:01.000Z',
        exitCode: 0
      };
    }
  } as unknown as WorkerClient;
}
