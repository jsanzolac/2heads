import type { AgentName } from './types.js';
import { agentDisplayName } from './prompts.js';

export interface ChatBubbleInput {
  agent: AgentName;
  index: number;
  total: number;
  label?: string;
  text: string;
  columns?: number;
}

const RESET = '\u001B[0m';
const BOLD_ON = '\u001B[1m';
const BOLD_OFF = '\u001B[22m';
const ITALIC_ON = '\u001B[3m';
const ITALIC_OFF = '\u001B[23m';
const UNDERLINE_ON = '\u001B[4m';
const UNDERLINE_OFF = '\u001B[24m';
const DIM_ON = '\u001B[2m';
const DIM_OFF = '\u001B[22m';

const STYLES = {
  claude: {
    bg: '\u001B[48;2;229;246;244m',
    fg: '\u001B[38;2;24;75;73m'
  },
  codex: {
    bg: '\u001B[48;2;244;240;255m',
    fg: '\u001B[38;2;67;50;118m'
  },
  recap: {
    bg: '\u001B[48;2;252;247;224m',
    fg: '\u001B[38;2;88;72;31m'
  }
} as const;

export function renderChatBubble(input: ChatBubbleInput): string {
  const columns = Math.max(48, input.columns ?? process.stdout.columns ?? 100);
  const isRecap = input.label === 'recap';
  const style = isRecap ? STYLES.recap : STYLES[input.agent];
  const bubbleWidth = Math.max(44, columns - 2);
  const bodyWidth = Math.max(30, bubbleWidth - 4);
  const header = `${agentDisplayName(input.agent)}${isRecap ? ' recap' : ''} ${progressText(input)}`;
  const rawLines = [
    header,
    '',
    ...formatBodyLines(normalizeMathForBubble(input.text.trim() || '(empty response)'), bodyWidth)
  ];

  const contentWidth = bodyWidth;
  const indent = ' ';

  const lines = rawLines.map((line, index) => {
    const formatted = index === 0 ? `${BOLD_ON}${line}${BOLD_OFF}` : formatMarkdownLine(line, contentWidth);
    return renderBubbleLine(indent, formatted, contentWidth, style.bg, style.fg);
  });

  return `\n${lines.join('\n')}\n`;
}

function renderBubbleLine(indent: string, content: string, width: number, bg: string, fg: string): string {
  const padded = ` ${content}${' '.repeat(Math.max(0, width - visibleLength(content)))} `;
  return `${indent}${bg}${fg}${padded}${RESET}`;
}

function formatMarkdownLine(line: string, width: number): string {
  if (!line) {
    return line;
  }

  const heading = /^(#{1,6})\s+(.+)$/.exec(line);
  if (heading?.[2]) {
    return `${BOLD_ON}${UNDERLINE_ON}${formatInlineMarkdown(heading[2])}${UNDERLINE_OFF}${BOLD_OFF}`;
  }

  if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
    return DIM_ON + '─'.repeat(Math.min(width, 48)) + DIM_OFF;
  }

  const bullet = /^(\s*)([-*+])\s+(.+)$/.exec(line);
  if (bullet?.[1] !== undefined && bullet[3]) {
    return `${bullet[1]}• ${formatInlineMarkdown(bullet[3])}`;
  }

  const numbered = /^(\s*)(\d+)\.\s+(.+)$/.exec(line);
  if (numbered?.[1] !== undefined && numbered[2] && numbered[3]) {
    return `${numbered[1]}${numbered[2]}. ${formatInlineMarkdown(numbered[3])}`;
  }

  return formatInlineMarkdown(line);
}

function formatInlineMarkdown(line: string): string {
  return line
    .replace(/`([^`]+)`/g, (_match, code: string) => `${UNDERLINE_ON}${code}${UNDERLINE_OFF}`)
    .replace(/\*\*([^*]+)\*\*/g, (_match, text: string) => `${BOLD_ON}${text}${BOLD_OFF}`)
    .replace(/__([^_]+)__/g, (_match, text: string) => `${BOLD_ON}${text}${BOLD_OFF}`)
    .replace(/(^|[^\*])\*([^*\s][^*]*?)\*(?!\*)/g, (_match, prefix: string, text: string) => {
      return `${prefix}${ITALIC_ON}${text}${ITALIC_OFF}`;
    })
    .replace(/(^|[^_])_([^_\s][^_]*?)_(?!_)/g, (_match, prefix: string, text: string) => {
      return `${prefix}${ITALIC_ON}${text}${ITALIC_OFF}`;
    });
}

function progressText(input: ChatBubbleInput): string {
  if (input.label === 'recap') {
    return '(final)';
  }

  return `(turn ${input.index} of ${input.total})`;
}

function normalizeMathForBubble(text: string): string {
  return text
    .replace(/```math\n([\s\S]*?)```/g, (_match, formula: string) => formatFormulaBlock(formula))
    .replace(/\$\$\s*([\s\S]*?)\s*\$\$/g, (_match, formula: string) => formatFormulaBlock(formula))
    .replace(/\\\[\s*([\s\S]*?)\s*\\\]/g, (_match, formula: string) => formatFormulaBlock(formula));
}

function formatFormulaBlock(formula: string): string {
  const clean = formula.trim();
  if (!clean) {
    return '';
  }

  return `\nformula:\n${clean
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n')}\n`;
}

function formatBodyLines(text: string, width: number): string[] {
  const sourceLines = text.replace(/\r\n/g, '\n').split('\n');
  const lines: string[] = [];
  let index = 0;

  while (index < sourceLines.length) {
    if (isTableStart(sourceLines, index)) {
      const tableLines: string[] = [];
      while (index < sourceLines.length && isTableRow(sourceLines[index] ?? '')) {
        tableLines.push(sourceLines[index] ?? '');
        index += 1;
      }
      lines.push(...renderMarkdownTable(tableLines, width));
      continue;
    }

    const line = sourceLines[index] ?? '';
    if (!line.trim()) {
      lines.push('');
    } else {
      lines.push(...wrapLine(line, width));
    }
    index += 1;
  }

  return lines;
}

function isTableStart(lines: string[], index: number): boolean {
  return isTableRow(lines[index] ?? '') && isSeparatorRow(lines[index + 1] ?? '');
}

function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.includes('|');
}

function isSeparatorRow(line: string): boolean {
  const cells = parseTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function parseTableRow(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) {
    return [];
  }

  return trimmed
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim());
}

function renderMarkdownTable(tableLines: string[], width: number): string[] {
  const rows = tableLines
    .filter((line) => !isSeparatorRow(line))
    .map(parseTableRow)
    .filter((row) => row.length > 0);

  if (rows.length === 0) {
    return [];
  }

  const columnCount = Math.max(...rows.map((row) => row.length));
  const normalizedRows = rows.map((row) => {
    return Array.from({ length: columnCount }, (_value, index) => row[index] ?? '');
  });
  const columnWidths = computeColumnWidths(normalizedRows, width);
  const output: string[] = [];

  normalizedRows.forEach((row, rowIndex) => {
    output.push(...renderTableRow(row, columnWidths));
    if (rowIndex === 0) {
      output.push(renderTableDivider(columnWidths));
    }
  });

  return output;
}

function computeColumnWidths(rows: string[][], width: number): number[] {
  const columnCount = rows[0]?.length ?? 1;
  const available = Math.max(columnCount * 8, width - (columnCount + 1) * 3);
  const natural = Array.from({ length: columnCount }, (_value, index) => {
    return Math.max(6, ...rows.map((row) => visibleLength(row[index] ?? '')));
  });
  const totalNatural = natural.reduce((sum, value) => sum + value, 0);

  if (totalNatural <= available) {
    return natural;
  }

  const base = Math.max(6, Math.floor(available / columnCount));
  return natural.map((value) => Math.min(value, base));
}

function renderTableRow(row: string[], columnWidths: number[]): string[] {
  const wrappedCells = row.map((cell, index) => wrapLine(cell || ' ', columnWidths[index] ?? 10));
  const rowHeight = Math.max(...wrappedCells.map((cellLines) => cellLines.length));
  const output: string[] = [];

  for (let lineIndex = 0; lineIndex < rowHeight; lineIndex += 1) {
    const cells = wrappedCells.map((cellLines, cellIndex) => {
      const cellLine = cellLines[lineIndex] ?? '';
      const width = columnWidths[cellIndex] ?? 10;
      return ` ${cellLine}${' '.repeat(Math.max(0, width - visibleLength(cellLine)))} `;
    });
    output.push(`│${cells.join('│')}│`);
  }

  return output;
}

function renderTableDivider(columnWidths: number[]): string {
  return `├${columnWidths.map((width) => '─'.repeat(width + 2)).join('┼')}┤`;
}

function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  const normalized = text.replace(/\r\n/g, '\n');

  for (const block of normalized.split('\n')) {
    if (!block.trim()) {
      lines.push('');
      continue;
    }

    lines.push(...wrapLine(block, width));
  }

  return lines;
}

function wrapLine(line: string, width: number): string[] {
  const words = line.split(/(\s+)/).filter((part) => part.length > 0);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (/^\s+$/.test(word)) {
      if (current && !current.endsWith(' ')) {
        current += ' ';
      }
      continue;
    }

    if (!current) {
      current = word;
      continue;
    }

    if (visibleLength(`${current}${word}`) <= width) {
      current += word;
      continue;
    }

    lines.push(current.trimEnd());
    current = word;
  }

  if (current) {
    lines.push(current.trimEnd());
  }

  return lines.flatMap((candidate) => splitLongLine(candidate, width));
}

function splitLongLine(line: string, width: number): string[] {
  if (visibleLength(line) <= width) {
    return [line];
  }

  const chunks: string[] = [];
  for (let index = 0; index < line.length; index += width) {
    chunks.push(line.slice(index, index + width));
  }

  return chunks;
}

function visibleLength(value: string): number {
  return value.replace(/\u001B\[[0-9;]*m/g, '').length;
}
