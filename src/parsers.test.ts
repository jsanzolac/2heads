import { describe, expect, it } from 'vitest';
import { AgentOutputParser } from './parsers.js';

describe('AgentOutputParser', () => {
  it('extracts Claude partial assistant messages without duplicating prefixes', () => {
    const parser = new AgentOutputParser('claude');

    const first = parser.processLine(
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] } })
    );
    const second = parser.processLine(
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Hello world' }] } })
    );
    const final = parser.processLine(JSON.stringify({ type: 'result', result: 'Hello world' }));

    expect(first).toContainEqual({ type: 'delta', text: 'Hello' });
    expect(second).toContainEqual({ type: 'delta', text: ' world' });
    expect(final).toContainEqual({ type: 'final', text: 'Hello world' });
    expect(parser.finish()).toBe('Hello world');
  });

  it('extracts Codex delta and final-style events', () => {
    const parser = new AgentOutputParser('codex');

    const delta = parser.processLine(JSON.stringify({ type: 'agent_message_delta', delta: 'A' }));
    const final = parser.processLine(JSON.stringify({ type: 'turn_completed', last_agent_message: 'Answer' }));

    expect(delta).toContainEqual({ type: 'delta', text: 'A' });
    expect(final).toContainEqual({ type: 'final', text: 'Answer' });
    expect(parser.finish()).toBe('Answer');
  });

  it('extracts Codex completed agent message items', () => {
    const parser = new AgentOutputParser('codex');

    const output = parser.processLine(
      JSON.stringify({
        type: 'item.completed',
        item: { id: 'item_0', type: 'agent_message', text: 'ready' }
      })
    );

    expect(output).toContainEqual({ type: 'delta', text: 'ready' });
    expect(parser.finish()).toBe('ready');
  });

  it('falls back to plain text output', () => {
    const parser = new AgentOutputParser('codex');

    expect(parser.processLine('plain output')).toEqual([{ type: 'delta', text: 'plain output\n' }]);
    expect(parser.finish()).toBe('plain output');
  });
});
