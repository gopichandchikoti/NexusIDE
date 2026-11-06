import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { fail, isQuotaError, type Result } from '@/domain/errors';
import type { FsNode } from '@/domain/fs';

export const DB_NAME = 'nexuside';
export const DB_VERSION = 1;

export interface Draft {
  readonly fileId: string;
  readonly content: string;
  /** UTC epoch ms when this unsaved buffer was journaled */
  readonly savedAt: number;
}

export interface Backup {
  readonly id?: number;
  readonly label: string;
  readonly createdAt: number;
  readonly nodes: readonly FsNode[];
}

export interface NexusDb extends DBSchema {
  nodes: { key: string; value: FsNode };
  drafts: { key: string; value: Draft };
  backups: { key: number; value: Backup };
  meta: { key: string; value: { key: string; value: unknown } };
}

export type Db = IDBPDatabase<NexusDb>;

let pending: Promise<Db> | null = null;

/**
 * Schema history:
 *  v1: nodes, drafts, backups, meta
 * Add a `case` per version below; each case must be additive so partially upgraded data stays readable.
 */
function upgrade(db: Db, oldVersion: number): void {
  if (oldVersion < 1) {
    db.createObjectStore('nodes', { keyPath: 'id' });
    db.createObjectStore('drafts', { keyPath: 'fileId' });
    db.createObjectStore('backups', { keyPath: 'id', autoIncrement: true });
    db.createObjectStore('meta', { keyPath: 'key' });
  }
}

export function getDb(): Promise<Db> {
  if (!pending) {
    pending = openDB<NexusDb>(DB_NAME, DB_VERSION, {
      upgrade: (db, oldVersion) => upgrade(db, oldVersion),
      terminated: () => {
        pending = null;
      },
    }).then(db => {
      db.addEventListener('versionchange', () => {
        db.close();
        pending = null;
      });
      return db;
    });
    pending.catch(() => {
      pending = null;
    });
  }
  return pending;
}

export async function closeDb(): Promise<void> {
  const current = pending;
  pending = null;
  if (current) (await current.catch(() => null))?.close();
}

/** Runs a storage operation and converts browser exceptions into structured errors. */
export async function withDb<T>(op: (db: Db) => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await op(await getDb()) };
  } catch (cause) {
    if (isQuotaError(cause)) {
      return fail('QUOTA_EXCEEDED', 'Browser storage is full. Export a ZIP, then delete files or old backups.');
    }
    const detail = cause instanceof Error ? cause.name : 'unknown';
    return fail('STORAGE_UNAVAILABLE', 'Browser storage is unavailable, so changes will not be saved.', detail);
  }
}
