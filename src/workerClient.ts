import { join } from 'node:path';
import { getAgentChannelPaths } from './channelPaths.js';
import type { AgentName, TurnRequest, TurnResult, WorkerChannelName, WorkerEvent } from './types.js';
import { createId, isoNow, pathExists, readFileFromOffset, readJson, sleep, writeJsonAtomic } from './utils.js';

export interface RunWorkerTurnOptions {
  agent?: AgentName;
  prompt: string;
  timeoutMs: number;
  pollMs: number;
  onEvent: (event: WorkerEvent) => Promise<void>;
}

export class WorkerClient {
  constructor(
    private readonly sessionDir: string,
    public readonly channel: WorkerChannelName,
    public readonly defaultAgent: AgentName
  ) {}

  async waitUntilReady(timeoutMs: number): Promise<void> {
    const paths = getAgentChannelPaths(this.sessionDir, this.channel);
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (await pathExists(paths.ready)) {
        return;
      }

      await sleep(100);
    }

    throw new Error(`${this.channel} worker did not become ready within ${timeoutMs}ms`);
  }

  async runTurn(options: RunWorkerTurnOptions): Promise<TurnResult> {
    const agent = options.agent ?? this.defaultAgent;
    const id = createId(this.channel);
    const paths = getAgentChannelPaths(this.sessionDir, this.channel);
    const request: TurnRequest = {
      id,
      agent,
      prompt: options.prompt,
      createdAt: isoNow()
    };

    const eventPath = join(paths.events, `${id}.jsonl`);
    const responsePath = join(paths.responses, `${id}.json`);
    let offset = 0;
    let pending = '';
    const deadline = Date.now() + options.timeoutMs;

    await writeJsonAtomic(join(paths.requests, `${id}.json`), request);

    while (Date.now() < deadline) {
      const read = await readFileFromOffset(eventPath, offset);
      offset = read.offset;
      pending += read.chunk;
      pending = await consumeCompleteJsonLines(pending, options.onEvent);

      if (await pathExists(responsePath)) {
        const finalRead = await readFileFromOffset(eventPath, offset);
        offset = finalRead.offset;
        pending += finalRead.chunk;
        pending = await consumeCompleteJsonLines(pending, options.onEvent);
        return readJson<TurnResult>(responsePath);
      }

      await sleep(options.pollMs);
    }

    throw new Error(`${this.channel} turn timed out after ${options.timeoutMs}ms`);
  }
}

async function consumeCompleteJsonLines(
  buffer: string,
  onEvent: (event: WorkerEvent) => Promise<void>
): Promise<string> {
  const lines = buffer.split(/\r?\n/);
  const pending = lines.pop() ?? '';

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    await onEvent(JSON.parse(line) as WorkerEvent);
  }

  return pending;
}
