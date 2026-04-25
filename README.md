# 2heads

2HEADS helps you think through complex decisions by forcing two models to reason in public, challenge each other's assumptions, and expose trade-offs before you commit.

`2heads` is a tmux-backed terminal REPL that passes a prompt between Claude and Codex for a fixed number of rounds, then asks a separate recap worker to summarize the exchange.

## Usage

```sh
npm install
npm run build
node dist/cli.js --rounds 1
```

The CLI requires `tmux`, `claude`, and `codex` on `PATH`. This repository does not install those tools automatically.

Inside the REPL:

- `:quit` exits and cleans up the tmux session.
- `:rounds <n>` changes the number of two-agent rounds.
- `:first claude|codex` changes which agent starts.
- `:attach` attaches to the background tmux session.
- `:last` prints the last recorded model answer.
- `:help` shows available commands.

You can tag files in a prompt with `@path`, for example:

```text
Compare the CLI flow in @src/cli.ts with the worker protocol in @src/worker.ts
```

Use quotes for paths with spaces:

```text
Review @"docs/decision note.md"
```

Tagged files are resolved relative to the active workdir. Their contents are sent to Claude and Codex only in the seeded prompts for the current exchange; later model-to-model handoffs still pass only the latest answer.

## Architecture

`2heads` has one foreground process and three background workers.

The foreground CLI owns the terminal UI, command parsing, transcript writing, and turn orchestration. It starts a dedicated tmux session for each run, then opens three panes inside it:

- Claude worker: runs Claude turns.
- Codex worker: runs Codex turns.
- Recap worker: runs the final summary in a separate model session.

The workers communicate with the CLI through JSON files under `.2heads/sessions/<session-id>/`. For each turn, the CLI writes a request file, the worker picks it up, streams events back into event files, and writes a final response file. The CLI records those events and final answers into the transcript.

Within one REPL run, Claude and Codex keep persistent model sessions. The first handoff seeds a model with the user prompt and any tagged file context; later turns send only the latest model answer, relying on that model's existing session context instead of resending the whole transcript. Each handoff explicitly asks the next model to push back on the previous answer before building on it. Starting the CLI again creates fresh tmux and model sessions.

The recap worker is intentionally separate from the active Claude/Codex exchange. It receives the full back-and-forth once, after the exchange is done, and produces the final recap without contaminating either active debate session.

On exit, `2heads` kills the tmux server for the run and removes its socket unless you start with `--keep-tmux`.

Agents are prompted to use Markdown math notation for formulas: `$...$` inline and `$$...$$` for display formulas. The terminal UI highlights those formulas while preserving the raw notation in transcripts.

The terminal output is rendered as full-width chat bubbles. Claude, Codex, and the recap all align left while keeping distinct background colors. Model answers are buffered per turn so each bubble can be wrapped cleanly. Basic Markdown is formatted inside bubbles, including headings, bold, italic, inline code, bullets, numbered lists, horizontal rules, and simple pipe tables.

In an interactive terminal, the bottom composer is rendered as a fixed textbox-style panel. It stays active while agents are thinking, so you can type the next message during an exchange; `2heads` queues it and runs it after the current exchange finishes. The composer shows a small spinner with the active agent and turn count so it is clear whether Claude, Codex, or the recap worker is currently running.

Transcripts are saved under `.2heads/sessions/`.
