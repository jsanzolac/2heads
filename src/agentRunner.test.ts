import { describe, expect, it } from 'vitest';
import { buildAgentCommand } from './agentRunner.js';

describe('buildAgentCommand', () => {
  it('keeps Claude sessions persistent and resumes by session id', () => {
    const first = buildAgentCommand('claude', 'hello', '/tmp/project');
    const resumed = buildAgentCommand('claude', 'hello again', '/tmp/project', '00000000-0000-4000-8000-000000000001');

    expect(first.args).not.toContain('--no-session-persistence');
    expect(first.args).not.toContain('--session-id');
    expect(resumed.args).toContain('--session-id');
    expect(resumed.args).toContain('00000000-0000-4000-8000-000000000001');
  });

  it('starts Codex persistently and resumes later turns by thread id', () => {
    const first = buildAgentCommand('codex', 'hello', '/tmp/project');
    const resumed = buildAgentCommand('codex', 'hello again', '/tmp/project', '019dc562-91a5-7783-83b2-2b7c0bde0bb5');

    expect(first.args).not.toContain('--ephemeral');
    expect(first.args).toContain('exec');
    expect(first.args).not.toContain('resume');
    expect(resumed.args).toEqual(
      expect.arrayContaining([
        'exec',
        'resume',
        '--json',
        '--skip-git-repo-check',
        '019dc562-91a5-7783-83b2-2b7c0bde0bb5',
        '-'
      ])
    );
  });
});
