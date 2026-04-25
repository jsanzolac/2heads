#!/usr/bin/env node
import { readdir, rename } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runAgentTurn } from './agentRunner.js';
import { getAgentChannelPaths } from './channelPaths.js';
import type { AgentName, TurnRequest, TurnResult, WorkerChannelName, WorkerEvent } from './types.js';
import { appendJsonLine, ensureDir, isoNow, readJson, sleep, writeJsonAtomic } from './utils.js';

interface WorkerOptions {
  channel: WorkerChannelName;
  defaultAgent: AgentName;
  sessionDir: string;
  workdir: string;
  pollMs: number;
}

export async function runWorker(options: WorkerOptions): Promise<void> {
  const paths = getAgentChannelPaths(options.sessionDir, options.channel);
  const sessionIds: Partial<Record<AgentName, string>> = {};
  await Promise.all([
    ensureDir(paths.requests),
    ensureDir(paths.processed),
    ensureDir(paths.responses),
    ensureDir(paths.events)
  ]);

  await writeJsonAtomic(paths.ready, {
    channel: options.channel,
    defaultAgent: options.defaultAgent,
    pid: process.pid,
    workdir: options.workdir,
    readyAt: isoNow()
  });

  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);

  while (!stopped) {
    const files = await readdir(paths.requests).catch(() => []);
    const requestFiles = files.filter((file) => file.endsWith('.json')).sort();

    for (const file of requestFiles) {
      if (stopped) {
        break;
      }

      await handleRequest(options, sessionIds, join(paths.requests, file), join(paths.processed, file));
    }

    await sleep(options.pollMs);
  }
}

async function handleRequest(
  options: WorkerOptions,
  sessionIds: Partial<Record<AgentName, string>>,
  requestPath: string,
  processedPath: string
): Promise<void> {
  const paths = getAgentChannelPaths(options.sessionDir, options.channel);
  await rename(requestPath, processedPath).catch(() => undefined);

  const request = await readJson<TurnRequest>(processedPath);
  const eventPath = join(paths.events, `${request.id}.jsonl`);
  const startedAt = isoNow();

  const onEvent = async (event: WorkerEvent) => {
    await appendJsonLine(eventPath, event);
  };

  const result = await runAgentTurn({
    agent: request.agent,
    turnId: request.id,
    prompt: request.prompt,
    workdir: options.workdir,
    ...(sessionIds[request.agent] ? { sessionId: sessionIds[request.agent] } : {}),
    onEvent
  });
  if (result.sessionId) {
    sessionIds[request.agent] = result.sessionId;
  }

  const finishedAt = isoNow();
  const response: TurnResult = {
    id: request.id,
    agent: request.agent,
    answer: result.answer,
    startedAt,
    finishedAt,
    exitCode: result.exitCode,
    ...(result.sessionId ? { sessionId: result.sessionId } : {})
  };

  await onEvent({
    type: 'final',
    turnId: request.id,
    agent: request.agent,
    timestamp: finishedAt,
    text: result.answer
  });
  await writeJsonAtomic(join(paths.responses, `${request.id}.json`), response);
}

function parseWorkerArgs(argv: string[]): WorkerOptions {
  const args = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value?.startsWith('--')) {
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args.set(value.slice(2), 'true');
    } else {
      args.set(value.slice(2), next);
      index += 1;
    }
  }

  const agent = args.get('agent');
  const channel = args.get('channel') ?? agent;
  const sessionDir = args.get('session-dir');
  const workdir = args.get('workdir') ?? process.cwd();

  if (agent !== 'claude' && agent !== 'codex') {
    throw new Error('Worker requires --agent claude|codex');
  }

  if (!sessionDir) {
    throw new Error('Worker requires --session-dir');
  }

  return {
    channel: parseChannel(channel),
    defaultAgent: agent,
    sessionDir,
    workdir,
    pollMs: Number(args.get('poll-ms') ?? 100)
  };
}

function parseChannel(value: string | undefined): WorkerChannelName {
  if (value === 'claude' || value === 'codex' || value === 'recap') {
    return value;
  }

  throw new Error('Worker requires --channel claude|codex|recap');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runWorker(parseWorkerArgs(process.argv.slice(2))).catch((error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${basename(process.argv[1] ?? 'worker')}: ${message}\n`);
    process.exitCode = 1;
  });
}
