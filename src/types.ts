export type AgentName = 'claude' | 'codex';
export type WorkerChannelName = AgentName | 'recap';

export interface TurnRequest {
  id: string;
  agent: AgentName;
  prompt: string;
  createdAt: string;
}

export type WorkerEventType = 'start' | 'delta' | 'stderr' | 'raw' | 'error' | 'final';

export interface WorkerEvent {
  type: WorkerEventType;
  turnId: string;
  agent: AgentName;
  timestamp: string;
  text?: string;
  message?: string;
  data?: unknown;
}

export interface TurnResult {
  id: string;
  agent: AgentName;
  answer: string;
  startedAt: string;
  finishedAt: string;
  exitCode: number;
  sessionId?: string;
}

export interface TranscriptTurn {
  id: string;
  conversationId: string;
  round: number;
  index: number;
  agent: AgentName;
  userPrompt: string;
  prompt: string;
  answer: string;
  startedAt: string;
  finishedAt: string;
  exitCode: number;
  label?: string;
}

export interface DebateTurn {
  agent: AgentName;
  answer: string;
}
