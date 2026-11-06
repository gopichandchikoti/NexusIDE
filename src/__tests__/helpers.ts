import { listBackups } from '@/services/workspaceRepo';

/** Test support: how many automatic backups exist. */
export async function getBackupCount(): Promise<number> {
  const result = await listBackups();
  return result.ok ? result.value.length : -1;
}
