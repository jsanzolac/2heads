import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TranscriptTurn, WorkerEvent } from './types.js';
import { agentDisplayName } from './prompts.js';
import { appendJsonLine, ensureDir, isoNow, readJson, writeJsonAtomic } from './utils.js';

export interface SessionStoreMeta {
  sessionName: string;
  workdir: string;
  rounds: number;
  firstAgent: string;
}

export class SessionStore {
  readonly turnsPath: string;
  readonly eventsPath: string;
  readonly transcriptPath: string;
  readonly metaPath: string;
  private turns: TranscriptTurn[] = [];

  private constructor(
    readonly dir: string,
    private readonly meta: SessionStoreMeta
  ) {
    this.turnsPath = join(dir, 'turns.json');
    this.eventsPath = join(dir, 'events.jsonl');
    this.transcriptPath = join(dir, 'transcript.md');
    this.metaPath = join(dir, 'meta.json');
  }

  static async create(dir: string, meta: SessionStoreMeta): Promise<SessionStore> {
    const store = new SessionStore(dir, meta);
    await ensureDir(dir);
    await writeJsonAtomic(store.metaPath, {
      ...meta,
      createdAt: isoNow()
    });
    await writeJsonAtomic(store.turnsPath, []);
    await store.writeMarkdown();
    return store;
  }

  static async load(dir: string, meta: SessionStoreMeta): Promise<SessionStore> {
    const store = new SessionStore(dir, meta);
    store.turns = await readJson<TranscriptTurn[]>(store.turnsPath);
    return store;
  }

  async recordEvent(event: WorkerEvent): Promise<void> {
    await appendJsonLine(this.eventsPath, event);
  }

  async recordTurn(turn: TranscriptTurn): Promise<void> {
    this.turns.push(turn);
    await writeJsonAtomic(this.turnsPath, this.turns);
    await this.writeMarkdown();
  }

  lastAnswer(): string | undefined {
    return this.turns.at(-1)?.answer;
  }

  private async writeMarkdown(): Promise<void> {
    const lines = [
      '# 2heads Session',
      '',
      `- Session: ${this.meta.sessionName}`,
      `- Workdir: ${this.meta.workdir}`,
      `- Default rounds: ${this.meta.rounds}`,
      `- Default first agent: ${this.meta.firstAgent}`,
      ''
    ];

    if (this.turns.length === 0) {
      lines.push('No turns recorded yet.', '');
    }

    for (const turn of this.turns) {
      const title = turn.label ? `${agentDisplayName(turn.agent)} - ${turn.label}` : `${agentDisplayName(turn.agent)} - round ${turn.round}`;
      lines.push(
        `## ${turn.index}. ${title}`,
        '',
        '### User prompt',
        '',
        turn.userPrompt.trim(),
        '',
        '### Answer',
        '',
        turn.answer.trim(),
        ''
      );
    }

    await writeFile(this.transcriptPath, lines.join('\n'), 'utf8');
  }
}
