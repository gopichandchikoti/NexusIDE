import JSZip from 'jszip';
import { fail, ok, type Result } from '@/domain/errors';
import { fromEntries, toEntries, type EntryInput, type FsState } from '@/domain/fs';
import { LIMITS } from '@/domain/limits';

export interface ZipImport {
  readonly state: FsState;
  /** Human-readable reasons for entries that were left out */
  readonly skipped: readonly string[];
}

export async function exportZip(state: FsState): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const entry of toEntries(state)) {
    if (entry.kind === 'folder') zip.folder(entry.path);
    else zip.file(entry.path, entry.content ?? '');
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

const IGNORED = [/^__MACOSX\//, /(^|\/)\.DS_Store$/, /(^|\/)node_modules\//];
const decoder = new TextDecoder('utf-8', { fatal: true });

function decodeText(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  try {
    return decoder.decode(bytes);
  } catch {
    return null;
  }
}

async function toBytes(data: Blob | ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(await data.arrayBuffer());
}

async function readEntries(zip: JSZip): Promise<Result<{ entries: EntryInput[]; skipped: string[] }>> {
  const entries: EntryInput[] = [];
  const skipped: string[] = [];
  let expanded = 0;
  for (const [rawName, file] of Object.entries(zip.files)) {
    const name = rawName.replace(/\\/g, '/');
    if (IGNORED.some(rx => rx.test(name))) {
      if (!file.dir) skipped.push(`${name} (not supported)`);
      continue;
    }
    if (file.dir) {
      entries.push({ path: name, kind: 'folder' });
      continue;
    }
    const bytes = await file.async('uint8array');
    expanded += bytes.length;
    if (expanded > LIMITS.maxZipExpandedBytes) {
      return fail('ZIP_TOO_LARGE', 'The archive expands to more than the 25 MB workspace import limit.');
    }
    const text = bytes.length > LIMITS.maxFileBytes ? null : decodeText(bytes);
    if (text === null) skipped.push(`${name} (binary or over 1 MB; only text files are supported)`);
    else entries.push({ path: name, kind: 'file', content: text });
  }
  return ok({ entries, skipped });
}

/** Imports a ZIP into a fresh state. Unsafe paths (zip-slip) reject the whole archive. */
export async function importZip(data: Blob | ArrayBuffer | Uint8Array): Promise<Result<ZipImport>> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await toBytes(data));
  } catch {
    return fail('ZIP_INVALID', 'That file is not a valid ZIP archive.');
  }
  if (Object.keys(zip.files).length > LIMITS.maxZipEntries) {
    return fail('ZIP_TOO_LARGE', `The archive has more than ${LIMITS.maxZipEntries} entries.`);
  }
  const read = await readEntries(zip);
  if (!read.ok) return read;
  const built = fromEntries(read.value.entries);
  if (!built.ok) {
    const unsafe = built.error.code === 'INVALID_PATH';
    return fail(unsafe ? 'ZIP_INVALID' : built.error.code, built.error.message, built.error.details);
  }
  return ok({ state: built.value, skipped: read.value.skipped });
}
