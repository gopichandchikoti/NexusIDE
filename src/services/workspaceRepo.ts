import { fail, ok, type Result } from '@/domain/errors';
import type { FsNode, FsState } from '@/domain/fs';
import { LIMITS } from '@/domain/limits';
import { DB_NAME, closeDb, withDb, type Backup, type Draft } from './db';
import { sanitizeNodes } from './sanitize';

export interface LoadedWorkspace {
  readonly state: FsState;
  readonly hadData: boolean;
  readonly dropped: number;
  readonly repaired: number;
}

export function loadWorkspace(): Promise<Result<LoadedWorkspace>> {
  return withDb(async db => {
    const raw = await db.getAll('nodes');
    const report = sanitizeNodes(raw);
    return { state: report.state, hadData: raw.length > 0, dropped: report.dropped, repaired: report.repaired };
  });
}

/** Writes only what changed between two states, in one transaction. */
export function saveChanges(prev: FsState, next: FsState): Promise<Result<void>> {
  const changed = Object.values(next).filter(n => prev[n.id] !== n);
  const removed = Object.keys(prev).filter(id => !(id in next));
  if (changed.length === 0 && removed.length === 0) return Promise.resolve(ok(undefined));
  return withDb(async db => {
    const tx = db.transaction('nodes', 'readwrite');
    await Promise.all([...changed.map(n => tx.store.put(n)), ...removed.map(id => tx.store.delete(id)), tx.done]);
  });
}

export function replaceAll(next: FsState): Promise<Result<void>> {
  return withDb(async db => {
    const tx = db.transaction(['nodes', 'drafts'], 'readwrite');
    await tx.objectStore('nodes').clear();
    await tx.objectStore('drafts').clear();
    await Promise.all([...Object.values(next).map(n => tx.objectStore('nodes').put(n)), tx.done]);
  });
}

export function putDraft(draft: Draft): Promise<Result<void>> {
  return withDb(async db => {
    await db.put('drafts', draft);
  });
}

export function removeDrafts(fileIds: readonly string[]): Promise<Result<void>> {
  return withDb(async db => {
    const tx = db.transaction('drafts', 'readwrite');
    await Promise.all([...fileIds.map(id => tx.store.delete(id)), tx.done]);
  });
}

export function listDrafts(): Promise<Result<Draft[]>> {
  return withDb(db => db.getAll('drafts'));
}

export function createBackup(state: FsState, label: string, now: number = Date.now()): Promise<Result<void>> {
  const nodes = Object.values(state);
  if (nodes.length === 0) return Promise.resolve(ok(undefined));
  return withDb(async db => {
    const tx = db.transaction('backups', 'readwrite');
    await tx.store.add({ label, createdAt: now, nodes });
    const keys = await tx.store.getAllKeys();
    const excess = keys.slice(0, Math.max(0, keys.length - LIMITS.backupsKept));
    await Promise.all([...excess.map(k => tx.store.delete(k)), tx.done]);
  });
}

export function listBackups(): Promise<Result<Backup[]>> {
  return withDb(async db => (await db.getAll('backups')).sort((a, b) => b.createdAt - a.createdAt));
}

export async function restoreBackup(id: number): Promise<Result<FsState>> {
  const found = await withDb(db => db.get('backups', id));
  if (!found.ok) return found;
  if (!found.value) return fail('NOT_FOUND', 'That backup no longer exists.');
  return ok(sanitizeNodes(found.value.nodes as FsNode[]).state);
}

export function deleteBackup(id: number): Promise<Result<void>> {
  return withDb(db => db.delete('backups', id));
}

export async function wipeAllData(): Promise<Result<void>> {
  await closeDb();
  return new Promise(resolve => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve(ok(undefined));
    request.onerror = () => resolve(fail('STORAGE_UNAVAILABLE', 'Could not delete stored data.'));
    request.onblocked = () => resolve(fail('STORAGE_UNAVAILABLE', 'Close other NexusIDE tabs, then try again.'));
  });
}

export interface StorageEstimate {
  readonly usage: number;
  readonly quota: number;
}

export async function estimateStorage(): Promise<StorageEstimate | null> {
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (estimate?.usage === undefined || estimate.quota === undefined) return null;
    return { usage: estimate.usage, quota: estimate.quota };
  } catch {
    return null;
  }
}
