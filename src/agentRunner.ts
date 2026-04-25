import { execa } from 'execa';
import { AgentOutputParser } from './parsers.js';
import type { AgentName, WorkerEvent } from './types.js';
import { isoNow } from './utils.js';

export interface RunAgentTurnInput {
  agent: AgentName;
  turnId: string;
  prompt: string;
  workdir: string;
  sessionId?: string;
  onEvent: (event: WorkerEvent) => Promise<void>;
}

export interface RunAgentTurnResult {
  answer: string;
  exitCode: number;
  sessionId?: string;
}

export async function runAgentTurn(input: RunAgentTurnInput): Promise<RunAgentTurnResult> {
  const parser = new AgentOutputParser(input.agent);
  const { command, args, stdin } = buildAgentCommand(input.agent, input.prompt, input.workdir, input.sessionId);
  const rawStdout: string[] = [];
  let sessionId = input.sessionId;

  await input.onEvent({
    type: 'start',
    turnId: input.turnId,
    agent: input.agent,
    timestamp: isoNow()
  });

  try {
    const subprocess = execa(command, args, {
      cwd: input.workdir,
      env: {
        ...process.env,
        NO_COLOR: '1'
      },
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      reject: false
    });

    subprocess.stdin?.end(stdin);

    await Promise.all([
      consumeLines(subprocess.stdout, async (line) => {
        rawStdout.push(line);
        const rawData = parseJsonLine(line);
        sessionId = extractSessionId(input.agent, rawData) ?? sessionId;

        for (const output of parser.processLine(line)) {
          if (output.type === 'raw') {
            await input.onEvent({
              type: 'raw',
              turnId: input.turnId,
              agent: input.agent,
              timestamp: isoNow(),
              data: output.data
            });
          } else if (output.type === 'delta') {
            await input.onEvent({
              type: 'delta',
              turnId: input.turnId,
              agent: input.agent,
              timestamp: isoNow(),
              text: output.text
            });
          } else {
            await input.onEvent({
              type: 'final',
              turnId: input.turnId,
              agent: input.agent,
              timestamp: isoNow(),
              text: output.text
            });
          }
        }
      }),
      consumeLines(subprocess.stderr, async (line) => {
        await input.onEvent({
          type: 'stderr',
          turnId: input.turnId,
          agent: input.agent,
          timestamp: isoNow(),
          text: `${line}\n`
        });
      })
    ]);

    const result = await subprocess;
    return {
      answer: parser.finish(rawStdout.join('\n')),
      exitCode: result.exitCode ?? 0,
      ...(sessionId ? { sessionId } : {})
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await input.onEvent({
      type: 'error',
      turnId: input.turnId,
      agent: input.agent,
      timestamp: isoNow(),
      message
    });
    return {
      answer: '',
      exitCode: 1,
      ...(sessionId ? { sessionId } : {})
    };
  }
}

export function buildAgentCommand(
  agent: AgentName,
  prompt: string,
  workdir: string,
  sessionId?: string
): { command: string; args: string[]; stdin: string } {
  if (agent === 'claude') {
    return {
      command: 'claude',
      args: [
        '--print',
        '--verbose',
        '--output-format',
        'stream-json',
        '--include-partial-messages',
        '--input-format',
        'text',
        '--tools',
        '',
        '--permission-mode',
        'plan',
        ...(sessionId ? ['--session-id', sessionId] : [])
      ],
      stdin: prompt
    };
  }

  if (sessionId) {
    return {
      command: 'codex',
      args: [
        '--ask-for-approval',
        'never',
        '--sandbox',
        'read-only',
        '--cd',
        workdir,
        'exec',
        'resume',
        '--json',
        '--skip-git-repo-check',
        sessionId,
        '-'
      ],
      stdin: prompt
    };
  }

  return {
    command: 'codex',
    args: [
      '--ask-for-approval',
      'never',
      'exec',
      '--json',
      '--color',
      'never',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      '--cd',
      workdir,
      '-'
    ],
    stdin: prompt
  };
}

function parseJsonLine(line: string): unknown {
  try {
    return JSON.parse(line.trim()) as unknown;
  } catch {
    return undefined;
  }
}

function extractSessionId(agent: AgentName, data: unknown): string | undefined {
  const obj = asRecord(data);
  if (!obj) {
    return undefined;
  }

  const direct = agent === 'claude' ? obj.session_id : obj.thread_id;
  return typeof direct === 'string' && direct ? direct : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return undefined;
}

async function consumeLines(
  stream: AsyncIterable<Buffer | string> | null | undefined,
  onLine: (line: string) => Promise<void>
): Promise<void> {
  if (!stream) {
    return;
  }

  let buffer = '';
  for await (const chunk of stream) {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      await onLine(line);
    }
  }

  if (buffer) {
    await onLine(buffer);
  }
}
