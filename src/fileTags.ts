import { open, readdir, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

export const MAX_TAGGED_FILE_BYTES = 200_000;

export interface FileTag {
  input: string;
  path: string;
  bytes: number;
  truncated: boolean;
}

export interface FileTagResolution {
  tags: FileTag[];
  warnings: string[];
  context?: string;
}

export interface FileTagSuggestion {
  path: string;
  kind: 'file' | 'directory';
}

interface ParsedFileTag {
  input: string;
  quoted: boolean;
}

export async function resolveFileTags(input: string, workdir: string): Promise<FileTagResolution> {
  const parsedTags = uniqueTags(parseFileTags(input));
  const tags: FileTag[] = [];
  const warnings: string[] = [];
  const contextSections: string[] = [];

  for (const parsed of parsedTags) {
    const absolutePath = resolve(workdir, parsed.input);
    const relativePath = relative(workdir, absolutePath);

    if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
      warnings.push(`Skipped @${parsed.input}: file is outside the workdir.`);
      continue;
    }

    const fileStat = await stat(absolutePath).catch(() => undefined);
    if (!fileStat) {
      warnings.push(`Skipped @${parsed.input}: file was not found.`);
      continue;
    }

    if (!fileStat.isFile()) {
      warnings.push(`Skipped @${parsed.input}: only regular files can be tagged.`);
      continue;
    }

    const readBytes = Math.min(fileStat.size, MAX_TAGGED_FILE_BYTES);
    const selected = await readFileStart(absolutePath, readBytes);

    if (isProbablyBinary(selected)) {
      warnings.push(`Skipped @${parsed.input}: file appears to be binary.`);
      continue;
    }

    const truncated = fileStat.size > MAX_TAGGED_FILE_BYTES;
    const content = selected.toString('utf8');
    tags.push({
      input: parsed.input,
      path: relativePath || parsed.input,
      bytes: fileStat.size,
      truncated
    });
    contextSections.push(formatTaggedFile(relativePath || parsed.input, content, truncated));
  }

  return {
    tags,
    warnings,
    ...(contextSections.length > 0 ? { context: contextSections.join('\n\n') } : {})
  };
}

export async function findFileTagSuggestions(
  query: string,
  workdir: string,
  limit = 6
): Promise<FileTagSuggestion[]> {
  const cleanQuery = query.replace(/^\.?\//, '');
  const slashIndex = cleanQuery.lastIndexOf('/');
  const parent = slashIndex === -1 ? '' : cleanQuery.slice(0, slashIndex + 1);
  const baseName = slashIndex === -1 ? cleanQuery : cleanQuery.slice(slashIndex + 1);
  const parentPath = resolve(workdir, parent);
  const parentRelative = relative(workdir, parentPath);

  if (parentRelative.startsWith('..') || isAbsolute(parentRelative)) {
    return [];
  }

  const entries = await readdir(parentPath, { withFileTypes: true }).catch(() => []);
  const normalizedParent = parent ? parent.replace(/\/?$/, '/') : '';
  const showHidden = baseName.startsWith('.');

  return entries
    .filter((entry) => {
      if (!showHidden && entry.name.startsWith('.')) {
        return false;
      }

      if (entry.isDirectory() && IGNORED_SUGGESTION_DIRS.has(entry.name)) {
        return false;
      }

      return entry.isDirectory() || entry.isFile();
    })
    .filter((entry) => entry.name.toLowerCase().startsWith(baseName.toLowerCase()))
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) {
        return a.isDirectory() ? -1 : 1;
      }

      return a.name.localeCompare(b.name);
    })
    .slice(0, limit)
    .map((entry) => {
      const kind = entry.isDirectory() ? 'directory' : 'file';
      return {
        path: `${normalizedParent}${entry.name}${kind === 'directory' ? '/' : ''}`,
        kind
      };
    });
}

export function parseFileTags(input: string): ParsedFileTag[] {
  const tags: ParsedFileTag[] = [];
  let index = 0;

  while (index < input.length) {
    const atIndex = input.indexOf('@', index);
    if (atIndex === -1) {
      break;
    }

    if (atIndex > 0 && !/\s/.test(input[atIndex - 1] ?? '')) {
      index = atIndex + 1;
      continue;
    }

    const next = input[atIndex + 1];
    if (!next || /\s/.test(next)) {
      index = atIndex + 1;
      continue;
    }

    if (next === '"' || next === "'") {
      const end = input.indexOf(next, atIndex + 2);
      if (end === -1) {
        index = atIndex + 2;
        continue;
      }

      const value = input.slice(atIndex + 2, end).trim();
      if (value) {
        tags.push({ input: value, quoted: true });
      }
      index = end + 1;
      continue;
    }

    let end = atIndex + 1;
    while (end < input.length && !/\s/.test(input[end] ?? '')) {
      end += 1;
    }

    const value = stripTrailingPunctuation(input.slice(atIndex + 1, end));
    if (value) {
      tags.push({ input: value, quoted: false });
    }
    index = end;
  }

  return tags;
}

function uniqueTags(tags: ParsedFileTag[]): ParsedFileTag[] {
  const seen = new Set<string>();
  const output: ParsedFileTag[] = [];

  for (const tag of tags) {
    if (seen.has(tag.input)) {
      continue;
    }

    seen.add(tag.input);
    output.push(tag);
  }

  return output;
}

const IGNORED_SUGGESTION_DIRS = new Set([
  '.2heads',
  '.git',
  '.npm-cache',
  'coverage',
  'dist',
  'node_modules'
]);

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[),.;:!?]+$/g, '');
}

function isProbablyBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, Math.min(buffer.length, 8000)).includes(0);
}

async function readFileStart(path: string, bytes: number): Promise<Buffer> {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function formatTaggedFile(path: string, content: string, truncated: boolean): string {
  const truncatedNote = truncated ? `\n[truncated to first ${MAX_TAGGED_FILE_BYTES} bytes]` : '';
  return [
    `--- BEGIN TAGGED FILE: ${path} ---${truncatedNote}`,
    content.trimEnd(),
    `--- END TAGGED FILE: ${path} ---`
  ].join('\n');
}
