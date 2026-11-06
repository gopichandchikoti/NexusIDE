import { fail, ok, type Result } from './errors';
import { LIMITS, utf8Length } from './limits';

export type NodeKind = 'file' | 'folder';

export interface FsNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly kind: NodeKind;
  /** Text content. Always '' for folders. */
  readonly content: string;
  /** UTC epoch milliseconds */
  readonly createdAt: number;
  readonly updatedAt: number;
}

export type FsState = Readonly<Record<string, FsNode>>;

export interface FsDeps {
  newId(): string;
  now(): number;
}

export const defaultDeps: FsDeps = {
  newId: () => globalThis.crypto.randomUUID(),
  now: () => Date.now(),
};

export interface NewNodeInput {
  readonly parentId: string | null;
  readonly name: string;
  readonly kind: NodeKind;
  readonly content?: string;
}

export interface EntryInput {
  readonly path: string;
  readonly kind: NodeKind;
  readonly content?: string;
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

function hasForbiddenChar(name: string): boolean {
  for (const ch of name) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 32 || code === 127 || ch === '/' || ch === '\\') return true;
  }
  return false;
}

export function validateName(raw: string): Result<string> {
  const name = raw.trim();
  if (name === '') return fail('INVALID_NAME', 'Name cannot be empty.');
  if (name === '.' || name === '..') return fail('INVALID_NAME', `"${name}" is not a valid name.`);
  if (hasForbiddenChar(name)) return fail('INVALID_NAME', 'Names cannot contain slashes or control characters.');
  if (name.length > LIMITS.maxNameLength) {
    return fail('INVALID_NAME', `Names are limited to ${LIMITS.maxNameLength} characters.`);
  }
  return ok(name);
}

export function sortNodes(nodes: readonly FsNode[]): FsNode[] {
  return [...nodes].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    return collator.compare(a.name, b.name);
  });
}

/** Children grouped by parent id (null = root), each group sorted folders-first. */
export function indexChildren(state: FsState): Map<string | null, FsNode[]> {
  const groups = new Map<string | null, FsNode[]>();
  for (const node of Object.values(state)) {
    const list = groups.get(node.parentId);
    if (list) list.push(node);
    else groups.set(node.parentId, [node]);
  }
  for (const [key, list] of groups) groups.set(key, sortNodes(list));
  return groups;
}

export function pathOf(state: FsState, id: string): string {
  const parts: string[] = [];
  let current = state[id];
  for (let guard = 0; current && guard <= LIMITS.maxDepth + 1; guard++) {
    parts.unshift(current.name);
    current = current.parentId === null ? undefined : state[current.parentId];
  }
  return parts.join('/');
}

export function depthOf(state: FsState, id: string | null): number {
  let depth = 0;
  let current = id === null ? undefined : state[id];
  while (current && depth <= LIMITS.maxDepth + 1) {
    depth += 1;
    current = current.parentId === null ? undefined : state[current.parentId];
  }
  return depth;
}

export function findByPath(state: FsState, path: string): FsNode | undefined {
  let parentId: string | null = null;
  let found: FsNode | undefined;
  for (const part of path.split('/')) {
    found = Object.values(state).find(n => n.parentId === parentId && n.name === part);
    if (!found) return undefined;
    parentId = found.id;
  }
  return found;
}

export function totalBytes(state: FsState): number {
  let sum = 0;
  for (const node of Object.values(state)) if (node.kind === 'file') sum += utf8Length(node.content);
  return sum;
}

function isNameTaken(state: FsState, parentId: string | null, name: string, exceptId?: string): boolean {
  const lower = name.toLowerCase();
  return Object.values(state).some(n => n.parentId === parentId && n.id !== exceptId && n.name.toLowerCase() === lower);
}

function checkContent(content: string): Result<number> {
  const bytes = utf8Length(content);
  if (bytes > LIMITS.maxFileBytes) {
    return fail('LIMIT_EXCEEDED', `Files are limited to ${Math.floor(LIMITS.maxFileBytes / 1000)} KB.`);
  }
  return ok(bytes);
}

function checkPlacement(state: FsState, input: NewNodeInput): Result<string> {
  const name = validateName(input.name);
  if (!name.ok) return name;
  if (input.parentId !== null && state[input.parentId]?.kind !== 'folder') {
    return fail('NOT_FOUND', 'The destination folder no longer exists.');
  }
  if (isNameTaken(state, input.parentId, name.value)) {
    return fail('DUPLICATE_NAME', `"${name.value}" already exists in this folder.`);
  }
  if (Object.keys(state).length >= LIMITS.maxFiles) {
    return fail('LIMIT_EXCEEDED', `A workspace can hold at most ${LIMITS.maxFiles} files and folders.`);
  }
  if (depthOf(state, input.parentId) >= LIMITS.maxDepth) {
    return fail('LIMIT_EXCEEDED', `Folders can be nested at most ${LIMITS.maxDepth} levels deep.`);
  }
  return name;
}

export function createNode(
  state: FsState,
  input: NewNodeInput,
  deps: FsDeps = defaultDeps
): Result<{ state: FsState; node: FsNode }> {
  const name = checkPlacement(state, input);
  if (!name.ok) return name;
  const content = input.kind === 'file' ? (input.content ?? '') : '';
  const size = checkContent(content);
  if (!size.ok) return size;
  if (totalBytes(state) + size.value > LIMITS.maxWorkspaceBytes) {
    return fail('LIMIT_EXCEEDED', 'The workspace is full. Delete files or export a ZIP first.');
  }
  const now = deps.now();
  const node: FsNode = {
    id: deps.newId(),
    parentId: input.parentId,
    name: name.value,
    kind: input.kind,
    content,
    createdAt: now,
    updatedAt: now,
  };
  return ok({ state: { ...state, [node.id]: node }, node });
}

export function renameNode(state: FsState, id: string, rawName: string, deps: FsDeps = defaultDeps): Result<FsState> {
  const node = state[id];
  if (!node) return fail('NOT_FOUND', 'That item no longer exists.');
  const name = validateName(rawName);
  if (!name.ok) return name;
  if (isNameTaken(state, node.parentId, name.value, id)) {
    return fail('DUPLICATE_NAME', `"${name.value}" already exists in this folder.`);
  }
  return ok({ ...state, [id]: { ...node, name: name.value, updatedAt: deps.now() } });
}

export function deleteNode(state: FsState, id: string): Result<{ state: FsState; removed: FsNode[] }> {
  if (!state[id]) return fail('NOT_FOUND', 'That item no longer exists.');
  const childrenOf = indexChildren(state);
  const removed: FsNode[] = [];
  const stack: string[] = [id];
  while (stack.length > 0) {
    const current = state[stack.pop() as string];
    if (!current) continue;
    removed.push(current);
    for (const child of childrenOf.get(current.id) ?? []) stack.push(child.id);
  }
  const next: Record<string, FsNode> = { ...state };
  for (const node of removed) delete next[node.id];
  return ok({ state: next, removed });
}

export function updateContent(
  state: FsState,
  id: string,
  content: string,
  deps: FsDeps = defaultDeps
): Result<FsState> {
  const node = state[id];
  if (node?.kind !== 'file') return fail('NOT_FOUND', 'That file no longer exists.');
  if (node.content === content) return ok(state);
  const size = checkContent(content);
  if (!size.ok) return size;
  const delta = size.value - utf8Length(node.content);
  if (delta > 0 && totalBytes(state) + delta > LIMITS.maxWorkspaceBytes) {
    return fail('LIMIT_EXCEEDED', 'The workspace is full. Delete files or export a ZIP first.');
  }
  return ok({ ...state, [id]: { ...node, content, updatedAt: deps.now() } });
}

export function toEntries(state: FsState): EntryInput[] {
  return Object.values(state)
    .map(n => ({ path: pathOf(state, n.id), kind: n.kind, content: n.kind === 'file' ? n.content : undefined }))
    .sort((a, b) => collator.compare(a.path, b.path));
}

function splitSafePath(path: string): Result<string[]> {
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
  const parts = trimmed.split('/');
  const bad =
    trimmed === '' ||
    path.startsWith('/') ||
    /^[a-zA-Z]:/.test(path) ||
    parts.some(p => p === '' || p === '.' || p === '..' || hasForbiddenChar(p) || p.length > LIMITS.maxNameLength);
  return bad ? fail('INVALID_PATH', `Unsafe or invalid path: ${JSON.stringify(path.slice(0, 80))}`) : ok(parts);
}

/** Builds a state from relative paths. Missing parent folders are created. Used by templates and ZIP import. */
export function fromEntries(entries: readonly EntryInput[], deps: FsDeps = defaultDeps): Result<FsState> {
  let state: FsState = {};
  const folderByPath = new Map<string, string>();
  const ensureFolder = (parts: string[]): Result<string | null> => {
    let parentId: string | null = null;
    for (let i = 0; i < parts.length; i++) {
      const key = parts.slice(0, i + 1).join('/');
      let id = folderByPath.get(key);
      if (id === undefined) {
        const made = createNode(state, { parentId, name: parts[i] as string, kind: 'folder' }, deps);
        if (!made.ok) return made;
        state = made.value.state;
        id = made.value.node.id;
        folderByPath.set(key, id);
      }
      parentId = id;
    }
    return ok(parentId);
  };
  for (const entry of entries) {
    const parts = splitSafePath(entry.path);
    if (!parts.ok) return parts;
    const dirParts = entry.kind === 'folder' ? parts.value : parts.value.slice(0, -1);
    const parent = ensureFolder(dirParts);
    if (!parent.ok) return parent;
    if (entry.kind === 'folder') continue;
    const made = createNode(
      state,
      {
        parentId: parent.value,
        name: parts.value[parts.value.length - 1] as string,
        kind: 'file',
        content: entry.content,
      },
      deps
    );
    if (!made.ok) return made;
    state = made.value.state;
  }
  return ok(state);
}
