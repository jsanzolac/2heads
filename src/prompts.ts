import type { AgentName, DebateTurn } from './types.js';

export const CHAT_ONLY_INSTRUCTION = [
  'You are participating in a two-agent terminal discussion.',
  'Respond in chat only.',
  'Do not run commands, edit files, call tools, request permissions, or ask the user for external actions.',
  'Give a direct, complete answer to the prompt you receive.',
  'If the discussion includes math, write formulas in Markdown math notation so the terminal can display them cleanly.',
  'Use `$...$` for inline formulas and `$$` blocks for display formulas, with the formula on its own lines inside the block.'
].join('\n');

export const PUSHBACK_INSTRUCTION = [
  'Push back on the previous answer before you build on it.',
  'Look for weak assumptions, missing edge cases, factual or logical errors, unclear tradeoffs, and places where the answer is overconfident.',
  'If you mostly agree, still explain what you tested mentally and what caveats or refinements matter.'
].join('\n');

export function agentDisplayName(agent: AgentName): string {
  return agent === 'claude' ? 'Claude' : 'Codex';
}

export interface ComposeTurnPromptInput {
  agent: AgentName;
  originalPrompt: string;
  context?: string;
  previousAgent?: AgentName;
  previousAnswer?: string;
  includeOriginalPrompt?: boolean;
}

export function composeTurnPrompt(input: ComposeTurnPromptInput): string {
  const sections = [
    CHAT_ONLY_INSTRUCTION
  ];

  if (input.includeOriginalPrompt ?? true) {
    sections.push('', 'User prompt:', input.originalPrompt.trim());
    if (input.context?.trim()) {
      sections.push(
        '',
        'Tagged file context:',
        'The user referenced these files with @file tags. Their contents are already included below as read-only context.',
        'Use this context directly when answering. Do not say you cannot open or access a tagged file unless that file is not listed below.',
        '',
        input.context.trim()
      );
    }
  }

  if (input.previousAgent && input.previousAnswer) {
    sections.push(
      '',
      `${agentDisplayName(input.previousAgent)} said this:`,
      '',
      input.previousAnswer.trim(),
      '',
      PUSHBACK_INSTRUCTION,
      '',
      'What do you think?'
    );
  } else {
    sections.push('', `You are ${agentDisplayName(input.agent)}. Answer the user prompt directly.`);
  }

  return `${sections.join('\n')}\n`;
}

export interface ComposeRecapPromptInput {
  agent: AgentName;
  originalPrompt: string;
  priorTurns: DebateTurn[];
}

export function composeRecapPrompt(input: ComposeRecapPromptInput): string {
  const transcript = formatPriorTurns(input.priorTurns);
  const sections = [
    CHAT_ONLY_INSTRUCTION,
    '',
    'Original user prompt:',
    input.originalPrompt.trim(),
    '',
    'Full back-and-forth:',
    transcript,
    '',
    `You are ${agentDisplayName(input.agent)}. Make a final recap of the full back-and-forth.`,
    'Do not lose details.',
    'Preserve each model\'s important claims, disagreements, refinements, conclusions, caveats, and open questions.',
    'Organize the recap so the user can understand what was said without reading the full transcript.'
  ];

  return `${sections.join('\n')}\n`;
}

export function formatPriorTurns(turns: DebateTurn[]): string {
  return turns
    .map((turn, index) => {
      return `[${index + 1}] ${agentDisplayName(turn.agent)}:\n${turn.answer.trim()}`;
    })
    .join('\n\n');
}
