import type { AgentName } from './types.js';

export type ParsedAgentOutput =
  | { type: 'delta'; text: string }
  | { type: 'final'; text: string }
  | { type: 'raw'; data: unknown };

export class AgentOutputParser {
  private visibleText = '';
  private finalText = '';

  constructor(private readonly agent: AgentName) {}

  processLine(line: string): ParsedAgentOutput[] {
    const trimmed = line.trim();
    if (!trimmed) {
      return [];
    }

    let data: unknown;
    try {
      data = JSON.parse(trimmed) as unknown;
    } catch {
      return this.emitDelta(`${line}\n`);
    }

    const outputs: ParsedAgentOutput[] = [{ type: 'raw', data }];
    const parsed = this.agent === 'claude' ? parseClaudeEvent(data) : parseCodexEvent(data);

    if (parsed.delta) {
      outputs.push(...this.emitDelta(parsed.delta));
    }

    if (parsed.fullText) {
      outputs.push(...this.emitFullText(parsed.fullText));
    }

    if (parsed.final) {
      this.finalText = parsed.final;
      outputs.push({ type: 'final', text: parsed.final });
    }

    return outputs;
  }

  finish(rawFallback = ''): string {
    return (this.finalText || this.visibleText || rawFallback).trim();
  }

  private emitDelta(text: string): ParsedAgentOutput[] {
    if (!text) {
      return [];
    }

    this.visibleText += text;
    return [{ type: 'delta', text }];
  }

  private emitFullText(text: string): ParsedAgentOutput[] {
    if (!text || text === this.visibleText) {
      return [];
    }

    if (text.startsWith(this.visibleText)) {
      const suffix = text.slice(this.visibleText.length);
      this.visibleText = text;
      return suffix ? [{ type: 'delta', text: suffix }] : [];
    }

    if (this.visibleText.includes(text)) {
      return [];
    }

    const prefix = this.visibleText && !this.visibleText.endsWith('\n') ? '\n' : '';
    this.visibleText += `${prefix}${text}`;
    return [{ type: 'delta', text: `${prefix}${text}` }];
  }
}

interface ParsedJsonEvent {
  delta?: string;
  fullText?: string;
  final?: string;
}

function parseClaudeEvent(data: unknown): ParsedJsonEvent {
  const obj = asRecord(data);
  if (!obj) {
    return {};
  }

  const type = stringValue(obj.type);
  const result = stringValue(obj.result);
  if (type === 'result' && result) {
    return { final: result };
  }

  const delta = extractTextContent(asRecord(obj.delta)?.text ?? obj.delta);
  if (type.includes('delta') && delta) {
    return { delta };
  }

  const message = asRecord(obj.message);
  const role = stringValue(message?.role);
  if ((type === 'assistant' || role === 'assistant') && message) {
    const fullText = extractTextContent(message.content);
    return fullText ? { fullText } : {};
  }

  const content = extractTextContent(obj.content);
  if (type === 'assistant' && content) {
    return { fullText: content };
  }

  return {};
}

function parseCodexEvent(data: unknown): ParsedJsonEvent {
  const obj = asRecord(data);
  if (!obj) {
    return {};
  }

  const type = stringValue(obj.type);
  const item = asRecord(obj.item);
  if (type === 'item.completed' && item && stringValue(item.type) === 'agent_message') {
    const fullText = extractTextContent(item.text ?? item.content);
    if (fullText) {
      return { fullText };
    }
  }

  const final = firstText(obj, ['last_agent_message', 'final_message', 'final_output', 'result', 'output']);
  if (final && /(complete|completed|result|final|done)/i.test(type)) {
    return { final };
  }

  if (/delta|chunk/i.test(type)) {
    const delta = firstText(obj, ['delta', 'text_delta', 'content_delta', 'chunk', 'text']);
    if (delta) {
      return { delta };
    }
  }

  if (/agent_message|assistant_message|message/i.test(type)) {
    const fullText = firstText(obj, ['message', 'content', 'text']);
    if (fullText) {
      return { fullText };
    }
  }

  if (final) {
    return { final };
  }

  return {};
}

function firstText(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const text = extractTextContent(obj[key]);
    if (text) {
      return text;
    }
  }

  return undefined;
}

function extractTextContent(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    const text = value.map(extractTextContent).filter(Boolean).join('');
    return text || undefined;
  }

  const obj = asRecord(value);
  if (!obj) {
    return undefined;
  }

  const directText = stringValue(obj.text);
  if (directText) {
    return directText;
  }

  const content = extractTextContent(obj.content);
  if (content) {
    return content;
  }

  const message = extractTextContent(obj.message);
  if (message) {
    return message;
  }

  const delta = extractTextContent(obj.delta);
  if (delta) {
    return delta;
  }

  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return undefined;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
