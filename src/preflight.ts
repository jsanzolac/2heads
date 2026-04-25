import { commandExists } from './utils.js';

export interface PreflightResult {
  ok: boolean;
  missing: string[];
  messages: string[];
}

export interface PreflightOptions {
  commands?: string[];
  exists?: (command: string) => Promise<boolean>;
}

export async function checkPreflight(options: PreflightOptions = {}): Promise<PreflightResult> {
  const commands = options.commands ?? ['tmux', 'codex', 'claude', 'node'];
  const exists = options.exists ?? commandExists;
  const missing: string[] = [];

  for (const command of commands) {
    if (!(await exists(command))) {
      missing.push(command);
    }
  }

  const messages = missing.map((command) => {
    if (command === 'tmux') {
      return 'Missing tmux. Install it first, for example with: brew install tmux';
    }

    return `Missing ${command}. Make sure it is installed and available on PATH.`;
  });

  return {
    ok: missing.length === 0,
    missing,
    messages
  };
}
