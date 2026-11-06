import JSZip from 'jszip';
import { beforeEach, describe, expect, it } from 'vitest';
import { fromEntries, type FsNode, type FsState } from '@/domain/fs';
import { LIMITS } from '@/domain/limits';
import { closeDb, withDb } from './db';
import { sanitizeNodes } from './sanitize';
import {
  createBackup,
  deleteBackup,
  listBackups,
  listDrafts,
  loadWorkspace,
  putDraft,
  removeDrafts,
  replaceAll,
  restoreBackup,
  saveChanges,
  wipeAllData,
} from './workspaceRepo';
import { exportZip, importZip } from './zip';

function ws(files: Record<string, string>): FsState {
  const r = fromEntries(Object.entries(files).map(([path, content]) => ({ path, kind: 'file' as const, content })));
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

const node = (over: Partial<FsNode> & { id: string }): FsNode => ({
  parentId: null,
  name: over.id,
  kind: 'file',
  content: '',
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

beforeEach(async () => {
  await wipeAllData();
});

/** Builds a one-entry, uncompressed ZIP whose entry name is exactly `name` (JSZip would sanitise it). */
function rawStoredZip(name: string, text: string): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  const data = new TextEncoder().encode(text);
  const local = new Uint8Array(30 + nameBytes.length + data.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(4, 20, true);
  lv.setUint32(18, data.length, true);
  lv.setUint32(22, data.length, true);
  lv.setUint16(26, nameBytes.length, true);
  local.set(nameBytes, 30);
  local.set(data, 30 + nameBytes.length);
  const central = new Uint8Array(46 + nameBytes.length);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(4, 20, true);
  cv.setUint16(6, 20, true);
  cv.setUint32(20, data.length, true);
  cv.setUint32(24, data.length, true);
  cv.setUint16(28, nameBytes.length, true);
  central.set(nameBytes, 46);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, central.length, true);
  ev.setUint32(16, local.length, true);
  return Uint8Array.from([...local, ...central, ...end]);
}

describe('sanitizeNodes', () => {
  it('drops garbage, duplicate ids and invalid names without throwing', () => {
    const r = sanitizeNodes([
      null,
      5,
      'x',
      {},
      { id: 'a', name: '../x', kind: 'file' },
      node({ id: 'ok' }),
      node({ id: 'ok' }),
    ]);
    expect(Object.keys(r.state)).toEqual(['ok']);
    expect(r.dropped).toBe(6);
  });

  it('re-parents orphans and cycles to the root', () => {
    const r = sanitizeNodes([
      node({ id: 'orphan', parentId: 'ghost' }),
      node({ id: 'a', kind: 'folder', parentId: 'b' }),
      node({ id: 'b', kind: 'folder', parentId: 'a' }),
      node({ id: 'underFile', parentId: 'orphan' }),
    ]);
    expect(Object.values(r.state).every(n => n.parentId === null)).toBe(true);
    expect(r.repaired).toBe(4);
  });

  it('renames duplicate sibling names instead of losing data', () => {
    const r = sanitizeNodes([
      node({ id: '1', name: 'a.ts', createdAt: 1 }),
      node({ id: '2', name: 'A.ts', createdAt: 2 }),
    ]);
    expect(
      Object.values(r.state)
        .map(n => n.name)
        .sort()
    ).toEqual(['A (2).ts', 'a.ts']);
  });

  it('migrates the pre-1.0 prototype record shape (sample fixture)', () => {
    const legacySample = {
      id: 'L1',
      name: 'old.js',
      type: 'file',
      parentId: null,
      content: 'x',
      language: 'javascript',
      createdAt: 5,
      modifiedAt: 9,
    };
    const r = sanitizeNodes([legacySample]);
    expect(r.state.L1).toMatchObject({ kind: 'file', content: 'x', createdAt: 5, updatedAt: 9 });
    expect(r.dropped).toBe(0);
  });

  it('coerces bad content/timestamps instead of crashing', () => {
    const r = sanitizeNodes([{ id: 'x', name: 'f', kind: 'file', content: 42, createdAt: 'yesterday' }], 777);
    expect(r.state.x).toMatchObject({ content: '', createdAt: 777, updatedAt: 777 });
  });
});

describe('workspaceRepo', () => {
  it('starts empty, then roundtrips saved changes (diffed)', async () => {
    const empty = await loadWorkspace();
    expect(empty.ok && empty.value.hadData).toBe(false);
    const a = ws({ 'a.ts': '1', 'dir/b.ts': '2' });
    expect((await saveChanges({}, a)).ok).toBe(true);
    const loaded = await loadWorkspace();
    expect(loaded.ok && Object.keys(loaded.value.state).sort()).toEqual(Object.keys(a).sort());
    const first = Object.values(a).find(n => n.name === 'a.ts') as FsNode;
    const edited = { ...a, [first.id]: { ...first, content: 'changed' } };
    await saveChanges(a, edited);
    const afterEdit = await loadWorkspace();
    expect(afterEdit.ok && afterEdit.value.state[first.id]?.content).toBe('changed');
    const { [first.id]: _gone, ...rest } = edited;
    await saveChanges(edited, rest);
    const afterDelete = await loadWorkspace();
    expect(afterDelete.ok && afterDelete.value.state[first.id]).toBeUndefined();
  });

  it('survives corrupt rows on load and reports them', async () => {
    await withDb(async db => {
      await db.put('nodes', {
        id: 'good',
        parentId: null,
        name: 'good.txt',
        kind: 'file',
        content: 'ok',
        createdAt: 1,
        updatedAt: 1,
      });
      await db.put('nodes', { id: 'bad', name: 5 } as unknown as FsNode);
    });
    const r = await loadWorkspace();
    expect(r.ok && Object.keys(r.value.state)).toEqual(['good']);
    expect(r.ok && r.value.dropped).toBe(1);
  });

  it('journals drafts and clears them, and replaceAll clears drafts too', async () => {
    await putDraft({ fileId: 'f1', content: 'unsaved', savedAt: 10 });
    await putDraft({ fileId: 'f2', content: 'unsaved2', savedAt: 11 });
    const before = await listDrafts();
    expect(before.ok && before.value).toHaveLength(2);
    await removeDrafts(['f1']);
    const mid = await listDrafts();
    expect(mid.ok && mid.value.map(d => d.fileId)).toEqual(['f2']);
    await replaceAll(ws({ 'n.txt': '' }));
    const after = await listDrafts();
    expect(after.ok && after.value).toEqual([]);
  });

  it('keeps only the newest backups and restores one', async () => {
    for (let i = 0; i < LIMITS.backupsKept + 2; i++)
      await createBackup(ws({ [`f${i}.txt`]: `v${i}` }), `b${i}`, 1000 + i);
    const list = await listBackups();
    expect(list.ok && list.value).toHaveLength(LIMITS.backupsKept);
    expect(list.ok && list.value[0]?.label).toBe(`b${LIMITS.backupsKept + 1}`);
    const id = list.ok ? (list.value[0]?.id as number) : 0;
    const restored = await restoreBackup(id);
    expect(restored.ok && Object.values(restored.value)[0]?.content).toBe(`v${LIMITS.backupsKept + 1}`);
    await deleteBackup(id);
    const gone = await restoreBackup(id);
    expect(!gone.ok && gone.error.code).toBe('NOT_FOUND');
    expect((await createBackup({}, 'empty')).ok).toBe(true);
  });

  it('maps a QuotaExceededError to a structured error and other failures to STORAGE_UNAVAILABLE', async () => {
    const quota = await withDb(async () => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    expect(!quota.ok && quota.error.code).toBe('QUOTA_EXCEEDED');
    const other = await withDb(async () => {
      throw new Error('boom');
    });
    expect(!other.ok && other.error.code).toBe('STORAGE_UNAVAILABLE');
  });

  it('wipeAllData removes everything and the database can be reopened', async () => {
    await saveChanges({}, ws({ 'a.txt': '1' }));
    await closeDb();
    expect((await wipeAllData()).ok).toBe(true);
    const r = await loadWorkspace();
    expect(r.ok && r.value.hadData).toBe(false);
  });
});

describe('zip', () => {
  it('roundtrips files, nested folders and empty folders', async () => {
    const built = fromEntries([
      { path: 'a/b.ts', kind: 'file', content: 'B' },
      { path: 'top.md', kind: 'file', content: 'héllo ✓' },
      { path: 'empty/', kind: 'folder' },
    ]);
    if (!built.ok) throw new Error('fixture');
    const bytes = await exportZip(built.value);
    const back = await importZip(bytes);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const dump = (s: FsState) =>
      Object.values(s)
        .map(n => `${n.kind}:${n.name}:${n.content}`)
        .sort();
    expect(dump(back.value.state)).toEqual(dump(built.value));
  });

  it('rejects absolute and backslash-traversal paths', async () => {
    for (const evil of ['/etc/passwd', '..\\evil.txt', 'C:/Windows/x.txt']) {
      const zip = new JSZip();
      zip.file(evil, 'x', { createFolders: false });
      const r = await importZip(await zip.generateAsync({ type: 'uint8array' }));
      expect(!r.ok && r.error.code).toBe('ZIP_INVALID');
    }
  });

  it.each(['../evil.txt', 'a/../../evil.txt', '..//..//evil.txt'])(
    'never escapes the workspace for a hand-crafted %j entry',
    evilName => {
      return importZip(rawStoredZip(evilName, 'pwned')).then(r => {
        if (!r.ok) {
          expect(r.error.code).toBe('ZIP_INVALID');
          return;
        }
        const paths = Object.values(r.value.state).map(n => n.name);
        expect(paths.every(p => !p.includes('..') && !p.includes('/'))).toBe(true);
        expect(Object.values(r.value.state).every(n => n.parentId === null || r.value.state[n.parentId])).toBe(true);
      });
    }
  );

  it('rejects non-zip data, too many entries, and zip bombs', async () => {
    const notZip = await importZip(new Uint8Array([1, 2, 3, 4]));
    expect(!notZip.ok && notZip.error.code).toBe('ZIP_INVALID');
    const many = new JSZip();
    for (let i = 0; i <= LIMITS.maxZipEntries; i++) many.file(`f${i}.txt`, '');
    const tooMany = await importZip(await many.generateAsync({ type: 'uint8array' }));
    expect(!tooMany.ok && tooMany.error.code).toBe('ZIP_TOO_LARGE');
    const bomb = new JSZip();
    const fileBytes = LIMITS.maxFileBytes - 1;
    const fileCount = Math.floor(LIMITS.maxZipExpandedBytes / fileBytes) + 1;
    for (let i = 0; i < fileCount; i++) bomb.file(`z${i}.txt`, '0'.repeat(fileBytes));
    const big = await importZip(await bomb.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));
    expect(!big.ok && big.error.code).toBe('ZIP_TOO_LARGE');
  }, 15_000); // Building and inflating a >25 MB adversarial fixture is slower with coverage instrumentation.

  it('skips binary files, node_modules and OS junk, reporting why', async () => {
    const zip = new JSZip();
    zip.file('keep.txt', 'text');
    zip.file('image.bin', new Uint8Array([0, 255, 0, 1]));
    zip.file('node_modules/x/index.js', 'x');
    zip.file('__MACOSX/._keep.txt', 'x');
    zip.file('.DS_Store', 'x');
    const r = await importZip(await zip.generateAsync({ type: 'uint8array' }));
    expect(r.ok && Object.values(r.value.state).map(n => n.name)).toEqual(['keep.txt']);
    expect(r.ok && r.value.skipped).toHaveLength(4);
  });

  it('accepts Blob input', async () => {
    const bytes = await exportZip(ws({ 'a.txt': 'blob' }));
    const r = await importZip(new Blob([bytes as BlobPart]));
    expect(r.ok && Object.values(r.value.state)[0]?.content).toBe('blob');
  });
});
