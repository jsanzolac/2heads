import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { findFileTagSuggestions, parseFileTags, resolveFileTags } from './fileTags.js';

describe('parseFileTags', () => {
  it('finds unquoted and quoted @file tags', () => {
    expect(parseFileTags('Compare @src/cli.ts with @"docs/decision note.md".')).toEqual([
      { input: 'src/cli.ts', quoted: false },
      { input: 'docs/decision note.md', quoted: true }
    ]);
  });

  it('ignores email-style @ signs and empty tags', () => {
    expect(parseFileTags('email me at a@b.com and then @ src')).toEqual([]);
  });
});

describe('resolveFileTags', () => {
  it('loads tagged files as prompt context', async () => {
    const workdir = await mkdtemp(join(tmpdir(), '2heads-tags-'));
    await mkdir(join(workdir, 'src'));
    await writeFile(join(workdir, 'src', 'example.ts'), 'export const value = 42;\n', 'utf8');

    const result = await resolveFileTags('Review @src/example.ts', workdir);

    expect(result.warnings).toEqual([]);
    expect(result.tags).toEqual([
      {
        input: 'src/example.ts',
        path: 'src/example.ts',
        bytes: 25,
        truncated: false
      }
    ]);
    expect(result.context).toContain('--- BEGIN TAGGED FILE: src/example.ts ---');
    expect(result.context).toContain('export const value = 42;');
  });

  it('warns on files outside the workdir', async () => {
    const workdir = await mkdtemp(join(tmpdir(), '2heads-tags-'));
    const result = await resolveFileTags('Review @../secret.txt', workdir);

    expect(result.tags).toEqual([]);
    expect(result.warnings[0]).toContain('outside the workdir');
  });
});

describe('findFileTagSuggestions', () => {
  it('lists matching files and directories for the active @ query', async () => {
    const workdir = await mkdtemp(join(tmpdir(), '2heads-tags-'));
    await mkdir(join(workdir, 'src'));
    await writeFile(join(workdir, 'src', 'cli.ts'), 'cli', 'utf8');
    await writeFile(join(workdir, 'src', 'worker.ts'), 'worker', 'utf8');
    await writeFile(join(workdir, 'README.md'), 'readme', 'utf8');

    await expect(findFileTagSuggestions('s', workdir)).resolves.toEqual([
      { path: 'src/', kind: 'directory' }
    ]);
    await expect(findFileTagSuggestions('src/c', workdir)).resolves.toEqual([
      { path: 'src/cli.ts', kind: 'file' }
    ]);
  });
});
