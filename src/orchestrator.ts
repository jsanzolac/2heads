import type { AgentName, DebateTurn, TranscriptTurn, WorkerEvent } from './types.js';
import { agentDisplayName, composeRecapPrompt, composeTurnPrompt } from './prompts.js';
import { WorkerClient } from './workerClient.js';
import { otherAgent } from './utils.js';
import type { SessionStore } from './transcript.js';

export interface DebateOptions {
  userPrompt: string;
  promptContext?: string;
  rounds: number;
  firstAgent: AgentName;
  clients: Record<AgentName, WorkerClient>;
  recapClient: WorkerClient;
  transcript: SessionStore;
  timeoutMs: number;
  pollMs: number;
  output: DebateOutput;
}

export interface DebateOutput {
  turnStart(agent: AgentName, index: number, total: number, label?: string): void;
  delta(text: string): void;
  diagnostic(agent: AgentName, text: string): void;
  turnEnd(agent: AgentName): void;
}

export async function runDebate(options: DebateOptions): Promise<DebateTurn[]> {
  const priorTurns: DebateTurn[] = [];
  const conversationId = `conversation-${Date.now()}`;
  const exchangeTurns = options.rounds * 2;
  const totalTurns = exchangeTurns + 1;
  let previousAgent: AgentName | undefined;
  let previousAnswer: string | undefined;

  for (let index = 0; index < exchangeTurns; index += 1) {
    const agent = index % 2 === 0 ? options.firstAgent : otherAgent(options.firstAgent);
    const includeOriginalPrompt = index < 2;
    const promptInput = {
      agent,
      originalPrompt: options.userPrompt,
      ...(options.promptContext ? { context: options.promptContext } : {}),
      includeOriginalPrompt
    };
    const prompt =
      previousAgent && previousAnswer
        ? composeTurnPrompt({ ...promptInput, previousAgent, previousAnswer })
        : composeTurnPrompt(promptInput);

    const result = await runSingleTurn({
      options,
      agent,
      prompt,
      index,
      totalTurns,
      conversationId
    });

    priorTurns.push({ agent, answer: result.answer });
    previousAgent = agent;
    previousAnswer = result.answer;
  }

  const recapPrompt = composeRecapPrompt({
    agent: options.firstAgent,
    originalPrompt: options.userPrompt,
    priorTurns
  });
  const recapResult = await runSingleTurn({
    options,
    agent: options.firstAgent,
    client: options.recapClient,
    prompt: recapPrompt,
    index: exchangeTurns,
    totalTurns,
    conversationId,
    label: 'recap'
  });
  priorTurns.push({ agent: options.firstAgent, answer: recapResult.answer });

  return priorTurns;
}

interface RunSingleTurnInput {
  options: DebateOptions;
  agent: AgentName;
  client?: WorkerClient;
  prompt: string;
  index: number;
  totalTurns: number;
  conversationId: string;
  label?: string;
}

async function runSingleTurn(input: RunSingleTurnInput): Promise<{
  answer: string;
}> {
  input.options.output.turnStart(input.agent, input.index + 1, input.totalTurns, input.label);
  let streamed = '';

  const client = input.client ?? input.options.clients[input.agent];
  const result = await client.runTurn({
    agent: input.agent,
    prompt: input.prompt,
    timeoutMs: input.options.timeoutMs,
    pollMs: input.options.pollMs,
    onEvent: async (event: WorkerEvent) => {
      await input.options.transcript.recordEvent(event);

      if (event.type === 'delta' && event.text) {
        streamed += event.text;
        input.options.output.delta(event.text);
      } else if ((event.type === 'stderr' || event.type === 'error') && (event.text || event.message)) {
        input.options.output.diagnostic(input.agent, event.text ?? event.message ?? '');
      }
    }
  });

  const missing = missingSuffix(result.answer, streamed);
  if (missing) {
    input.options.output.delta(missing);
  }

  input.options.output.turnEnd(input.agent);

  const turn: TranscriptTurn = {
    id: result.id,
    conversationId: input.conversationId,
    round: input.label === 'recap' ? input.options.rounds + 1 : Math.floor(input.index / 2) + 1,
    index: input.index + 1,
    agent: input.agent,
    userPrompt: input.options.userPrompt,
    prompt: input.prompt,
    answer: result.answer,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    exitCode: result.exitCode,
    ...(input.label ? { label: input.label } : {})
  };

  await input.options.transcript.recordTurn(turn);

  if (result.exitCode !== 0) {
    throw new Error(`${agentDisplayName(input.agent)} turn failed with exit code ${result.exitCode}`);
  }

  return { answer: result.answer };
}

function missingSuffix(finalAnswer: string, streamed: string): string {
  if (!finalAnswer) {
    return '';
  }

  if (!streamed) {
    return finalAnswer;
  }

  if (finalAnswer.startsWith(streamed)) {
    return finalAnswer.slice(streamed.length);
  }

  const trimmedStreamed = streamed.trim();
  if (trimmedStreamed && finalAnswer.includes(trimmedStreamed)) {
    return '';
  }

  return '';
}

export function plainTurnHeader(agent: AgentName, index: number, total: number, label?: string): string {
  const title = label ? `${agentDisplayName(agent)} recap` : agentDisplayName(agent);
  const progress = label === 'recap' ? 'final' : `turn ${index} of ${total}`;
  return `\n${title} (${progress})\n\n`;
}
