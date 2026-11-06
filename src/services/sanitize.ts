import { validateName, type FsNode, type FsState } from '@/domain/fs';

export interface SanitizeReport {
  readonly state: FsState;
  /** Records that could not be interpreted at all */
  readonly dropped: number;
  /** Records kept but modified (orphan re-parented, duplicate renamed, ...) */
  readonly repaired: number;
}

type Loose = Record<string, unknown>;

function isRecord(value: unknown): value is Loose {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readName(raw: Loose): string | null {
  const name = typeof raw.name === 'string' ? validateName(raw.name) : null;
  return name?.ok ? name.value : null;
}

/**
 * Accepts the current record shape and the pre-1.0 prototype shape
 * (`type` instead of `kind`, `modifiedAt` instead of `updatedAt`).
 */
export function coerceNode(raw: unknown, now: number): FsNode | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || raw.id === '') return null;
  const kind = raw.kind ?? raw.type;
  const name = readName(raw);
  if ((kind !== 'file' && kind !== 'folder') || name === null) return null;
  return {
    id: raw.id,
    parentId: typeof raw.parentId === 'string' ? raw.parentId : null,
    name,
    kind,
    content: kind === 'file' ? readText(raw.content) : '',
    ...readTimestamps(raw, now),
  };
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readTimestamps(raw: Loose, now: number): { createdAt: number; updatedAt: number } {
  const createdAt = finiteOr(raw.createdAt, now);
  return { createdAt, updatedAt: finiteOr(raw.updatedAt ?? raw.modifiedAt, createdAt) };
}

function reachesRoot(nodes: Map<string, FsNode>, start: FsNode): boolean {
  const seen = new Set<string>();
  let current: FsNode | undefined = start;
  while (current) {
    if (seen.has(current.id)) return false;
    seen.add(current.id);
    if (current.parentId === null) return true;
    const parent: FsNode | undefined = nodes.get(current.parentId);
    if (parent?.kind !== 'folder') return false;
    current = parent;
  }
  return false;
}

function uniqueSiblingName(taken: Set<string>, name: string): string {
  if (!taken.has(name.toLowerCase())) return name;
  for (let n = 2; ; n++) {
    const dot = name.lastIndexOf('.');
    const candidate = dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

function readValid(raw: readonly unknown[], now: number): { nodes: Map<string, FsNode>; dropped: number } {
  const nodes = new Map<string, FsNode>();
  let dropped = 0;
  for (const item of raw) {
    const node = coerceNode(item, now);
    if (!node || nodes.has(node.id)) dropped += 1;
    else nodes.set(node.id, node);
  }
  return { nodes, dropped };
}

/** Nodes whose parent chain is broken (missing parent, parent is a file, cycle) move to the root. */
function rerootOrphans(nodes: Map<string, FsNode>): { nodes: FsNode[]; repaired: number } {
  let repaired = 0;
  const fixed = [...nodes.values()].map(node => {
    if (node.parentId === null || reachesRoot(nodes, node)) return node;
    repaired += 1;
    return { ...node, parentId: null };
  });
  return { nodes: fixed, repaired };
}

/** Case-insensitive sibling name clashes are resolved by renaming the newer node ("a (2).ts"). */
function dedupeNames(nodes: readonly FsNode[]): { state: Record<string, FsNode>; repaired: number } {
  const takenByParent = new Map<string | null, Set<string>>();
  const state: Record<string, FsNode> = {};
  let repaired = 0;
  const ordered = [...nodes].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  for (const node of ordered) {
    const taken = takenByParent.get(node.parentId) ?? new Set<string>();
    takenByParent.set(node.parentId, taken);
    const name = uniqueSiblingName(taken, node.name);
    taken.add(name.toLowerCase());
    if (name !== node.name) repaired += 1;
    state[node.id] = name === node.name ? node : { ...node, name };
  }
  return { state, repaired };
}

export function sanitizeNodes(raw: readonly unknown[], now: number = Date.now()): SanitizeReport {
  const valid = readValid(raw, now);
  const rooted = rerootOrphans(valid.nodes);
  const named = dedupeNames(rooted.nodes);
  return { state: named.state, dropped: valid.dropped, repaired: rooted.repaired + named.repaired };
}
