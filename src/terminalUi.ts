import { clearLine, createInterface, cursorTo, emitKeypressEvents, type Interface } from 'node:readline';
import pc from 'picocolors';
import type { AgentName } from './types.js';
import { agentDisplayName } from './prompts.js';

interface ThinkingState {
  agent: AgentName;
  index: number;
  total: number;
  label?: string;
}

const RESET = '\u001B[0m';
const INPUT_BG = '\u001B[48;2;41;44;52m';
const INPUT_BORDER = '\u001B[38;2;92;99;112m';
const INPUT_FG = '\u001B[38;2;232;238;246m';
const INPUT_ACCENT = '\u001B[38;2;142;211;218m';
const INPUT_DIM = '\u001B[38;2;159;166;178m';
const CLEAR_TO_END = '\u001B[K';
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const COMPOSER_HEIGHT = 4;
const MIN_COMPOSER_WIDTH = 44;
const SIDE_MARGIN = 2;

type TtyInput = NodeJS.ReadableStream & {
  isTTY?: boolean;
  setRawMode?: (enabled: boolean) => void;
  resume: () => NodeJS.ReadableStream;
  pause: () => NodeJS.ReadableStream;
};

export class TerminalUi {
  private readonly rl: Interface | undefined;
  private readonly isTty: boolean;
  private readonly queuedLines: string[] = [];
  private readonly waiters: Array<(line: string | undefined) => void> = [];
  private readonly keypressHandler: (text: string, key: KeypressKey) => void;
  private readonly resizeHandler: () => void;
  private thinking: ThinkingState | undefined;
  private spinner: NodeJS.Timeout | undefined;
  private spinnerIndex = 0;
  private inputBuffer = '';
  private cursorIndex = 0;
  private rawModeEnabled = false;
  private started = false;
  private closed = false;

  constructor(
    private readonly input: NodeJS.ReadableStream,
    private readonly output: NodeJS.WriteStream
  ) {
    this.isTty = Boolean(output.isTTY && (input as TtyInput).isTTY);
    this.keypressHandler = (text, key) => {
      this.handleKeypress(text, key);
    };
    this.resizeHandler = () => {
      this.reserveComposerSpace();
      this.drawComposer();
    };

    if (this.isTty) {
      this.rl = undefined;
      return;
    }

    this.rl = createInterface({
      input,
      output,
      terminal: false
    });

    this.rl.on('line', (line) => {
      this.enqueue(line);
    });

    this.rl.once('close', () => {
      this.closed = true;
      this.stopSpinner();
      while (this.waiters.length > 0) {
        this.waiters.shift()?.(undefined);
      }
    });
  }

  start(): void {
    this.started = true;
    if (this.isTty) {
      this.enableRawInput();
      this.reserveComposerSpace();
      this.drawComposer();
      return;
    }

    this.prompt();
  }

  readLine(): Promise<string | undefined> {
    const line = this.queuedLines.shift();
    if (line !== undefined) {
      return Promise.resolve(line);
    }

    if (this.closed) {
      return Promise.resolve(undefined);
    }

    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  write(text: string): void {
    if (this.isTty) {
      this.writeAboveComposer(text);
      return;
    }

    this.clearPromptLine();
    this.output.write(text);
    if (text && !text.endsWith('\n')) {
      this.output.write('\n');
    }
    this.prompt();
  }

  writeLine(text = ''): void {
    this.write(`${text}\n`);
  }

  startThinking(state: ThinkingState): void {
    this.thinking = state;
    this.spinnerIndex = 0;

    if (!this.isTty) {
      return;
    }

    this.stopSpinner();
    this.drawComposer();
    this.spinner = setInterval(() => {
      this.spinnerIndex = (this.spinnerIndex + 1) % SPINNER_FRAMES.length;
      this.drawComposer();
    }, 120);
  }

  stopThinking(): void {
    this.thinking = undefined;
    this.stopSpinner();
    if (this.isTty) {
      this.drawComposer();
    }
  }

  pause(): void {
    if (this.isTty) {
      this.clearComposer();
      this.resetScrollRegion();
      this.disableRawInput();
      this.input.pause();
      return;
    }

    this.clearPromptLine();
    this.rl?.pause();
  }

  resume(): void {
    if (this.isTty) {
      this.enableRawInput();
      this.input.resume();
      this.reserveComposerSpace();
      this.drawComposer();
      return;
    }

    this.rl?.resume();
    this.prompt();
  }

  close(): void {
    this.stopSpinner();
    if (this.isTty) {
      this.closed = true;
      this.clearComposer();
      this.resetScrollRegion();
      this.disableRawInput();
      this.output.write(RESET);
      return;
    }

    this.rl?.close();
  }

  private enqueue(line: string): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(line);
      return;
    }

    this.queuedLines.push(line);
  }

  private prompt(): void {
    if (!this.started || this.closed) {
      return;
    }

    this.rl?.setPrompt(this.renderPrompt());
    this.rl?.prompt(true);
  }

  private renderPrompt(): string {
    if (!this.isTty) {
      return 'You: ';
    }

    const status = this.thinking ? this.thinkingLabel(this.thinking) : 'ready';
    return `${INPUT_BG}${INPUT_FG} ${status} ${INPUT_ACCENT}You › ${INPUT_FG}${CLEAR_TO_END}`;
  }

  private thinkingLabel(state: ThinkingState): string {
    const frame = SPINNER_FRAMES[this.spinnerIndex] ?? SPINNER_FRAMES[0];
    const name = state.label === 'recap' ? `${agentDisplayName(state.agent)} recap` : agentDisplayName(state.agent);
    const progress = state.label === 'recap' ? 'final' : `${state.index}/${state.total}`;
    return `${frame} ${name} thinking ${pc.dim(`(${progress})`)}`;
  }

  private clearPromptLine(): void {
    if (!this.isTty) {
      return;
    }

    clearLine(this.output, 0);
    cursorTo(this.output, 0);
  }

  private stopSpinner(): void {
    if (!this.spinner) {
      return;
    }

    clearInterval(this.spinner);
    this.spinner = undefined;
  }

  private enableRawInput(): void {
    if (this.rawModeEnabled) {
      return;
    }

    emitKeypressEvents(this.input);
    this.input.on('keypress', this.keypressHandler);
    this.output.on('resize', this.resizeHandler);
    const ttyInput = this.input as TtyInput;
    ttyInput.setRawMode?.(true);
    ttyInput.resume();
    this.rawModeEnabled = true;
  }

  private disableRawInput(): void {
    if (!this.rawModeEnabled) {
      return;
    }

    this.input.off('keypress', this.keypressHandler);
    this.output.off('resize', this.resizeHandler);
    (this.input as TtyInput).setRawMode?.(false);
    this.rawModeEnabled = false;
  }

  private handleKeypress(text: string, key: KeypressKey): void {
    if (this.closed) {
      return;
    }

    if (key.ctrl && key.name === 'c') {
      process.kill(process.pid, 'SIGINT');
      return;
    }

    if (key.name === 'return' || key.name === 'enter') {
      const line = this.inputBuffer;
      this.inputBuffer = '';
      this.cursorIndex = 0;
      this.enqueue(line);
      this.drawComposer();
      return;
    }

    if (key.name === 'backspace') {
      if (this.cursorIndex > 0) {
        this.inputBuffer = `${this.inputBuffer.slice(0, this.cursorIndex - 1)}${this.inputBuffer.slice(this.cursorIndex)}`;
        this.cursorIndex -= 1;
        this.drawComposer();
      }
      return;
    }

    if (key.name === 'delete') {
      if (this.cursorIndex < this.inputBuffer.length) {
        this.inputBuffer = `${this.inputBuffer.slice(0, this.cursorIndex)}${this.inputBuffer.slice(this.cursorIndex + 1)}`;
        this.drawComposer();
      }
      return;
    }

    if (key.name === 'left') {
      this.cursorIndex = Math.max(0, this.cursorIndex - 1);
      this.drawComposer();
      return;
    }

    if (key.name === 'right') {
      this.cursorIndex = Math.min(this.inputBuffer.length, this.cursorIndex + 1);
      this.drawComposer();
      return;
    }

    if (key.ctrl && key.name === 'a') {
      this.cursorIndex = 0;
      this.drawComposer();
      return;
    }

    if (key.ctrl && key.name === 'e') {
      this.cursorIndex = this.inputBuffer.length;
      this.drawComposer();
      return;
    }

    if (key.ctrl && key.name === 'u') {
      this.inputBuffer = this.inputBuffer.slice(this.cursorIndex);
      this.cursorIndex = 0;
      this.drawComposer();
      return;
    }

    if (key.ctrl && key.name === 'k') {
      this.inputBuffer = this.inputBuffer.slice(0, this.cursorIndex);
      this.drawComposer();
      return;
    }

    if (key.ctrl || key.meta) {
      return;
    }

    const printable = text.replace(/[\u0000-\u001F\u007F]/g, '');
    if (!printable) {
      return;
    }

    this.inputBuffer = `${this.inputBuffer.slice(0, this.cursorIndex)}${printable}${this.inputBuffer.slice(this.cursorIndex)}`;
    this.cursorIndex += printable.length;
    this.drawComposer();
  }

  private reserveComposerSpace(): void {
    if (!this.isTty || this.closed) {
      return;
    }

    const rows = this.rows();
    const scrollBottom = Math.max(1, rows - COMPOSER_HEIGHT);
    this.output.write(`\u001B[1;${scrollBottom}r`);
    this.output.write(`\u001B[${scrollBottom};1H`);
  }

  private resetScrollRegion(): void {
    if (!this.isTty) {
      return;
    }

    this.output.write('\u001B[r');
    this.output.write(`\u001B[${this.rows()};1H`);
    this.output.write('\n');
  }

  private writeAboveComposer(text: string): void {
    this.reserveComposerSpace();
    this.output.write(RESET);
    this.output.write(`\u001B[${Math.max(1, this.rows() - COMPOSER_HEIGHT)};1H`);
    this.output.write(text);
    if (text && !text.endsWith('\n')) {
      this.output.write('\n');
    }
    this.drawComposer();
  }

  private drawComposer(): void {
    if (!this.started || this.closed || !this.isTty) {
      return;
    }

    const rows = this.rows();
    const startRow = Math.max(1, rows - COMPOSER_HEIGHT + 1);
    const layout = this.composerLayout();
    const lines = this.renderComposerLines(layout);
    let output = '';

    lines.forEach((line, index) => {
      output += `\u001B[${startRow + index};1H\u001B[2K${line}`;
    });

    output += `\u001B[${startRow + 2};${layout.cursorColumn}H`;
    this.output.write(output);
  }

  private clearComposer(): void {
    if (!this.isTty) {
      return;
    }

    const rows = this.rows();
    const startRow = Math.max(1, rows - COMPOSER_HEIGHT + 1);
    let output = '';
    for (let index = 0; index < COMPOSER_HEIGHT; index += 1) {
      output += `\u001B[${startRow + index};1H\u001B[2K`;
    }
    this.output.write(output);
  }

  private renderComposerLines(layout: ComposerLayout): string[] {
    const horizontal = '─'.repeat(layout.innerWidth + 2);
    const top = `${' '.repeat(layout.left)}${INPUT_BG}${INPUT_BORDER}╭${horizontal}╮${RESET}`;
    const status = this.statusText();
    const statusLine = padVisible(` ${status}`, layout.innerWidth + 2);
    const middleText = layout.visibleText || 'Ask anything';
    const inputText = layout.visibleText ? `${INPUT_FG}${middleText}` : `${INPUT_DIM}${middleText}`;
    const inputLine = padAnsi(` ${INPUT_ACCENT}+ ${INPUT_FG}You › ${inputText}`, layout.innerWidth + 2);
    const bottom = `${' '.repeat(layout.left)}${INPUT_BG}${INPUT_BORDER}╰${horizontal}╯${RESET}`;

    return [
      top,
      `${' '.repeat(layout.left)}${INPUT_BG}${INPUT_BORDER}│${INPUT_DIM}${statusLine}${INPUT_BORDER}│${RESET}`,
      `${' '.repeat(layout.left)}${INPUT_BG}${INPUT_BORDER}│${inputLine}${INPUT_BORDER}│${RESET}`,
      bottom
    ];
  }

  private composerLayout(): ComposerLayout {
    const columns = this.columns();
    const width = Math.max(MIN_COMPOSER_WIDTH, columns - SIDE_MARGIN * 2);
    const left = Math.max(0, Math.floor((columns - width) / 2));
    const innerWidth = Math.max(20, width - 2);
    const inputPrefixWidth = visibleLength(' + You › ');
    const textWidth = Math.max(8, innerWidth - inputPrefixWidth - 2);
    const visibleText = tailByWidth(this.inputBuffer, textWidth);
    const hiddenBefore = Math.max(0, this.inputBuffer.length - visibleText.length);
    const visibleCursor = Math.max(0, this.cursorIndex - hiddenBefore);
    const cursorColumn = left + 2 + inputPrefixWidth + visibleCursor;

    return {
      left,
      innerWidth,
      visibleText,
      cursorColumn
    };
  }

  private statusText(): string {
    if (!this.thinking) {
      const queued = this.queuedLines.length > 0 ? ` · ${this.queuedLines.length} queued` : '';
      return `ready${queued}`;
    }

    return this.thinkingLabel(this.thinking);
  }

  private rows(): number {
    return Math.max(12, this.output.rows ?? 24);
  }

  private columns(): number {
    return Math.max(48, this.output.columns ?? 100);
  }
}

interface ComposerLayout {
  left: number;
  innerWidth: number;
  visibleText: string;
  cursorColumn: number;
}

interface KeypressKey {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
}

function visibleLength(value: string): number {
  return value.replace(/\u001B\[[0-9;]*m/g, '').length;
}

function padVisible(value: string, width: number): string {
  return `${value}${' '.repeat(Math.max(0, width - visibleLength(value)))}`;
}

function padAnsi(value: string, width: number): string {
  return `${value}${' '.repeat(Math.max(0, width - visibleLength(value)))}`;
}

function tailByWidth(value: string, width: number): string {
  if (visibleLength(value) <= width) {
    return value;
  }

  return value.slice(Math.max(0, value.length - width));
}
