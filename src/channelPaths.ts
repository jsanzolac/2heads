import { join } from 'node:path';
import type { WorkerChannelName } from './types.js';

export interface AgentChannelPaths {
  root: string;
  requests: string;
  processed: string;
  responses: string;
  events: string;
  ready: string;
}

export function getAgentChannelPaths(sessionDir: string, channel: WorkerChannelName): AgentChannelPaths {
  const root = join(sessionDir, 'channels', channel);
  return {
    root,
    requests: join(root, 'requests'),
    processed: join(root, 'processed'),
    responses: join(root, 'responses'),
    events: join(root, 'events'),
    ready: join(root, 'ready.json')
  };
}
