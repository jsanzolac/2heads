#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { unlinkSync } from 'node:fs';
import { stdin as input, stdout as output } from 'node:process';
import { resolve, join } from 'node:path';
import { Command, InvalidArgumentError } from 'commander';
import pc from 'picocolors';
import { checkPreflight } from './preflight.js';
import { createSessionSlug } from './utils.js';
import type { AgentName } from './types.js';
import { SessionStore } from './transcript.js';
import { TmuxSupervisor } from './tmux.js';
import { WorkerClient } from './workerClient.js';
import { runDebate, type DebateOutput } from './orchestrator.js';
import { agentDisplayName } from './prompts.js';
import { renderChatBubble } from './chatBubble.js';
import { TerminalUi } from './terminalUi.js';
import { resolveFileTags } from './fileTags.js';

interface CliOptions {
  rounds: number;
  first: AgentName;
  workdir: string;
  sessionName?: string;
  keepTmux: boolean;
  turnTimeoutMs: number;
  pollMs: number;
}

const program = new Command()
  .name('2heads')
  .description('Run a tmux-backed Claude and Codex discussion REPL.')
  .option('--rounds <number>', 'number of two-agent rounds per prompt', parsePositiveInteger, 2)
  .option('--first <agent>', 'first agent for each prompt: claude or codex', parseAgentName, 'claude')
  .option('--workdir <path>', 'working directory for agent CLIs', process.cwd())
  .option('--session-name <name>', 'tmux session name')
  .option('--keep-tmux', 'leave the tmux session running after the REPL exits', false)
  .option('--turn-timeout-ms <number>', 'timeout for each agent turn', parsePositiveInteger, 600_000)
  .option('--poll-ms <number>', 'poll interval for worker channel files', parsePositiveInteger, 100);

program.parse();

const options = program.opts<CliOptions>();

main(options).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(pc.red(message));
  process.exitCode = 1;
});

async function main(cliOptions: CliOptions): Promise<void> {
  const preflight = await checkPreflight();
  if (!preflight.ok) {
    for (const message of preflight.messages) {
      console.error(pc.red(message));
    }
    process.exitCode = 1;
    return;
  }

  const workdir = resolve(cliOptions.workdir);
  const sessionSlug = createSessionSlug();
  const sessionDir = join(workdir, '.2heads', 'sessions', sessionSlug);
  const sessionName = cliOptions.sessionName ?? `2heads-${sessionSlug}`;

  const transcript = await SessionStore.create(sessionDir, {
    sessionName,
    workdir,
    rounds: cliOptions.rounds,
    firstAgent: cliOptions.first
  });

  const supervisor = new TmuxSupervisor({
    sessionName,
    sessionDir,
    workdir,
    pollMs: cliOptions.pollMs
  });

  const tmuxSocketPath = join(sessionDir, 'tmux.sock');
  let cleanupPromise: Promise<void> | undefined;
  let cleanupDone = false;
  const cleanup = async () => {
    if (cliOptions.keepTmux) {
      cleanupDone = true;
      return;
    }

    cleanupPromise ??= supervisor.kill().finally(() => {
      cleanupDone = true;
    });
    await cleanupPromise;
  };
  const cleanupSync = () => {
    if (cliOptions.keepTmux || cleanupDone) {
      return;
    }

    spawnSync('tmux', ['-S', tmuxSocketPath, 'kill-server'], { stdio: 'ignore' });
    try {
      unlinkSync(tmuxSocketPath);
    } catch {
      // Best effort only: the socket may already be gone.
    }
    cleanupDone = true;
  };

  process.once('SIGINT', () => {
    cleanup()
      .catch(() => undefined)
      .finally(() => {
        process.exit(130);
      });
  });
  process.once('beforeExit', () => {
    void cleanup().catch(() => undefined);
  });
  process.once('exit', cleanupSync);

  await supervisor.start();

  const clients: Record<AgentName, WorkerClient> = {
    claude: new WorkerClient(sessionDir, 'claude', 'claude'),
    codex: new WorkerClient(sessionDir, 'codex', 'codex')
  };
  const recapClient = new WorkerClient(sessionDir, 'recap', 'claude');

  await Promise.all([
    clients.claude.waitUntilReady(10_000),
    clients.codex.waitUntilReady(10_000),
    recapClient.waitUntilReady(10_000)
  ]);

  const ui = new TerminalUi(input, output);
  let rounds = cliOptions.rounds;
  let firstAgent = cliOptions.first;
  const debateOutput = createConsoleDebateOutput(ui);

  printWelcome({
    sessionName,
    transcriptPath: transcript.transcriptPath,
    rounds,
    firstAgent,
    ui
  });
  ui.start();

  try {
    while (true) {
      const line = await ui.readLine();
      if (line === undefined) {
        break;
      }
      const trimmed = line.trim();

      if (!trimmed) {
        continue;
      }

      if (trimmed.startsWith(':')) {
        const shouldContinue = await handleCommand(trimmed, {
          setRounds: (value) => {
            rounds = value;
          },
          setFirstAgent: (value) => {
            firstAgent = value;
          },
          getLastAnswer: () => transcript.lastAnswer(),
          write: (text) => {
            ui.write(text);
          },
          attach: async () => {
            ui.pause();
            await supervisor.attach();
            ui.resume();
          },
          quit: async () => {
            await cleanup();
          }
        });

        if (!shouldContinue) {
          break;
        }

        continue;
      }

      const fileTags = await resolveFileTags(line, workdir);
      for (const warning of fileTags.warnings) {
        ui.write(`${pc.yellow(warning)}\n`);
      }
      if (fileTags.tags.length > 0) {
        const fileWord = fileTags.tags.length === 1 ? 'file' : 'files';
        const paths = fileTags.tags.map((tag) => tag.path).join(', ');
        ui.write(`${pc.dim(`Tagged ${fileTags.tags.length} ${fileWord}: ${paths}`)}\n`);
      }

      await runDebate({
        userPrompt: line,
        ...(fileTags.context ? { promptContext: fileTags.context } : {}),
        rounds,
        firstAgent,
        clients,
        recapClient,
        transcript,
        timeoutMs: cliOptions.turnTimeoutMs,
        pollMs: cliOptions.pollMs,
        output: debateOutput
      });
    }
  } finally {
    ui.close();
    await cleanup();
  }
}

interface CommandHandlers {
  setRounds(value: number): void;
  setFirstAgent(value: AgentName): void;
  getLastAnswer(): string | undefined;
  write(text: string): void;
  attach(): Promise<void>;
  quit(): Promise<void>;
}

async function handleCommand(command: string, handlers: CommandHandlers): Promise<boolean> {
  const [name, ...args] = command.split(/\s+/);

  if (name === ':help') {
    handlers.write(formatHelp());
    return true;
  }

  if (name === ':quit' || name === ':exit') {
    await handlers.quit();
    return false;
  }

  if (name === ':rounds') {
    const value = Number(args[0]);
    if (!Number.isInteger(value) || value < 1) {
      handlers.write(`${pc.red('Usage: :rounds <positive integer>')}\n`);
    } else {
      handlers.setRounds(value);
      handlers.write(`${pc.dim(`Rounds set to ${value}. I will add a final recap after the exchange.`)}\n`);
    }
    return true;
  }

  if (name === ':first') {
    const agent = args[0];
    if (agent !== 'claude' && agent !== 'codex') {
      handlers.write(`${pc.red('Usage: :first claude|codex')}\n`);
    } else {
      handlers.setFirstAgent(agent);
      handlers.write(`${pc.dim(`First speaker set to ${agentDisplayName(agent)}.`)}\n`);
    }
    return true;
  }

  if (name === ':attach') {
    await handlers.attach();
    return true;
  }

  if (name === ':last') {
    const answer = handlers.getLastAnswer();
    handlers.write(answer ? `\n${answer}\n` : `${pc.dim('No answers recorded yet.')}\n`);
    return true;
  }

  handlers.write(`${pc.red(`Unknown command: ${name}`)}\n`);
  return true;
}

function createConsoleDebateOutput(ui: TerminalUi): DebateOutput {
  let currentTurn:
    | {
        agent: AgentName;
        index: number;
        total: number;
        label?: string;
        text: string;
      }
    | undefined;

  return {
    turnStart(agent, index, total, label) {
      currentTurn = {
        agent,
        index,
        total,
        ...(label ? { label } : {}),
        text: ''
      };
      ui.startThinking({ agent, index, total, ...(label ? { label } : {}) });
    },
    delta(text) {
      if (currentTurn) {
        currentTurn.text += text;
      }
    },
    diagnostic(agent, text) {
      ui.write(pc.dim(`${agentDisplayName(agent)} note: ${text}`));
    },
    turnEnd() {
      ui.stopThinking();
      if (!currentTurn) {
        ui.writeLine();
        return;
      }

      ui.write(
        renderChatBubble({
          agent: currentTurn.agent,
          index: currentTurn.index,
          total: currentTurn.total,
          text: currentTurn.text,
          columns: process.stdout.columns,
          ...(currentTurn.label ? { label: currentTurn.label } : {})
        })
      );
      currentTurn = undefined;
    }
  };
}

function printWelcome(input: {
  sessionName: string;
  transcriptPath: string;
  rounds: number;
  firstAgent: AgentName;
  ui: TerminalUi;
}): void {
  const first = agentDisplayName(input.firstAgent);
  const roundWord = input.rounds === 1 ? 'round' : 'rounds';
  const replyWord = input.rounds * 2 === 1 ? 'reply' : 'replies';

  input.ui.write(
    [
      '',
      pc.bold('2heads is ready'),
      pc.dim(`Flow: ${input.rounds} ${roundWord} (${input.rounds * 2} ${replyWord}), then a separate recap worker uses ${first}.`),
      pc.dim(`Transcript: ${input.transcriptPath}`),
      pc.dim(`Session: ${input.sessionName}`),
      pc.dim('Type :help for commands.'),
      ''
    ].join('\n')
  );
}

function formatHelp(): string {
  return [
    '',
    pc.bold('Commands'),
    `${pc.cyan(':rounds <n>')}  Set rounds before the recap; each round has both agents reply`,
    `${pc.cyan(':first claude|codex')}  Choose who starts; the separate recap worker uses that model`,
    `${pc.cyan(':last')}  Show the latest saved answer`,
    `${pc.cyan(':attach')}  Open the tmux worker session`,
    `${pc.cyan(':quit')}  Exit`,
    pc.dim('Files: tag local files with @path or @"path with spaces"; contents are sent only in the seeded prompts.'),
    pc.dim('Math: agents are prompted to use $...$ and $$...$$ notation for formulas.'),
    pc.dim('Sessions: Claude/Codex contexts persist inside this REPL; later turns send only the latest handoff.'),
    pc.dim('The bottom input bar stays active while agents think; typed lines are queued.'),
    pc.dim('Restarting the CLI creates fresh model sessions.'),
    ''
  ].join('\n');
}

function parsePositiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError('must be a positive integer');
  }

  return parsed;
}

function parseAgentName(value: string): AgentName {
  if (value !== 'claude' && value !== 'codex') {
    throw new InvalidArgumentError('must be claude or codex');
  }

  return value;
}
