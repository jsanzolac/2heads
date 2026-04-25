import { unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import type { AgentName, WorkerChannelName } from './types.js';
import { shellQuote } from './utils.js';

export interface TmuxSupervisorOptions {
  sessionName: string;
  sessionDir: string;
  workdir: string;
  pollMs: number;
}

export class TmuxSupervisor {
  private readonly socketPath: string;

  constructor(private readonly options: TmuxSupervisorOptions) {
    this.socketPath = join(options.sessionDir, 'tmux.sock');
  }

  async start(): Promise<void> {
    const claudeCommand = this.workerCommand('claude', 'claude');
    const codexCommand = this.workerCommand('codex', 'codex');
    const recapCommand = this.workerCommand('recap', 'claude');

    const started = await execa('tmux', [
      '-S',
      this.socketPath,
      'new-session',
      '-d',
      '-s',
      this.options.sessionName,
      '-n',
      'agents',
      '-c',
      this.options.workdir,
      claudeCommand
    ]);
    assertNoTmuxStartupError(started.stderr);

    await execa('tmux', [
      '-S',
      this.socketPath,
      'split-window',
      '-t',
      `${this.options.sessionName}:0`,
      '-h',
      '-c',
      this.options.workdir,
      codexCommand
    ]);

    await execa('tmux', [
      '-S',
      this.socketPath,
      'split-window',
      '-t',
      `${this.options.sessionName}:0`,
      '-v',
      '-c',
      this.options.workdir,
      recapCommand
    ]);

    await execa('tmux', [
      '-S',
      this.socketPath,
      'select-layout',
      '-t',
      `${this.options.sessionName}:0`,
      'tiled'
    ]).catch(() => undefined);
    await execa('tmux', [
      '-S',
      this.socketPath,
      'set-option',
      '-t',
      this.options.sessionName,
      'remain-on-exit',
      'on'
    ]).catch(() => undefined);
  }

  async attach(): Promise<void> {
    await execa('tmux', ['-S', this.socketPath, 'attach-session', '-t', this.options.sessionName], {
      stdio: 'inherit'
    });
  }

  async kill(): Promise<void> {
    await execa('tmux', ['-S', this.socketPath, 'kill-server']).catch(() => undefined);
    await unlink(this.socketPath).catch(() => undefined);
  }

  private workerCommand(channel: WorkerChannelName, agent: AgentName): string {
    const workerPath = fileURLToPath(new URL('./worker.js', import.meta.url));
    const args = [
      process.execPath,
      workerPath,
      '--channel',
      channel,
      '--agent',
      agent,
      '--session-dir',
      this.options.sessionDir,
      '--workdir',
      this.options.workdir,
      '--poll-ms',
      String(this.options.pollMs)
    ];

    return args.map(shellQuote).join(' ');
  }
}

export function defaultSessionName(sessionDir: string): string {
  return `2heads-${dirname(sessionDir).split('/').at(-1) ?? 'session'}`;
}

function assertNoTmuxStartupError(stderr: string): void {
  const message = stderr.trim();
  if (/^error\b/i.test(message)) {
    throw new Error(`tmux failed to start: ${message}`);
  }
}
