import { constants } from 'node:fs';
import { access, appendFile, mkdir, open, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { delimiter, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await ensureDir(dirname(path));
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(tempPath, path);
}

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

export async function appendJsonLine(path: string, value: unknown): Promise<void> {
  await ensureDir(dirname(path));
  await appendFile(path, `${JSON.stringify(value)}\n`, 'utf8');
}

export async function appendText(path: string, value: string): Promise<void> {
  await ensureDir(dirname(path));
  await appendFile(path, value, 'utf8');
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function isoNow(): string {
  return new Date().toISOString();
}

export function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

export function createSessionSlug(date = new Date()): string {
  const stamp = date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return `${stamp}-${randomUUID().slice(0, 8)}`;
}

export function otherAgent(agent: 'claude' | 'codex'): 'claude' | 'codex' {
  return agent === 'claude' ? 'codex' : 'claude';
}

export async function commandExists(command: string, pathEnv = process.env.PATH ?? ''): Promise<boolean> {
  if (command.includes('/')) {
    try {
      await access(command, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) {
      continue;
    }

    const candidate = join(dir, command);
    try {
      await access(candidate, constants.X_OK);
      return true;
    } catch {
      // Keep looking through PATH.
    }
  }

  return false;
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export async function readFileFromOffset(path: string, offset: number): Promise<{ chunk: string; offset: number }> {
  const fileStat = await stat(path).catch(() => undefined);
  if (!fileStat || fileStat.size <= offset) {
    return { chunk: '', offset };
  }

  const length = fileStat.size - offset;
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, offset);
    return {
      chunk: buffer.toString('utf8', 0, bytesRead),
      offset: offset + bytesRead
    };
  } finally {
    await handle.close();
  }
}
