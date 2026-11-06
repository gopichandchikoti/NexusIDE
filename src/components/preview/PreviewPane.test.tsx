// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { disposeRuntime } from '@/app/services';
import { fromEntries } from '@/domain/fs';
import { initialRunState } from '@/domain/runState';
import { useEditorStore } from '@/store/editorStore';
import { useRunStore } from '@/store/runStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { PreviewPane } from './PreviewPane';

beforeEach(() => {
  const fs = fromEntries([{ path: 'index.html', kind: 'file', content: '<h1>Preview works</h1>' }]);
  if (!fs.ok) throw new Error(fs.error.message);
  useWorkspaceStore.getState().hydrate(fs.value);
  useEditorStore.setState({ tabs: [], active: null });
  useRunStore.setState({ run: initialRunState, lines: [] });
});

afterEach(() => {
  cleanup();
  disposeRuntime();
});

describe('PreviewPane', () => {
  it.each([false, true])('can run and rerun a page under StrictMode (compact: %s)', async compact => {
    const user = userEvent.setup();
    render(
      <StrictMode>
        <PreviewPane compact={compact} />
      </StrictMode>
    );

    await user.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(useRunStore.getState().run.phase).toBe('running'));
    const firstFrame = screen.getByTitle('Preview of your project (sandboxed)');
    expect(firstFrame).toBeInTheDocument();
    expect(screen.queryByText('The preview could not start')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Run again' }));
    await waitFor(() => expect(useRunStore.getState().run.runId).toBe(2));
    expect(firstFrame).not.toBeInTheDocument();
    expect(screen.getByTitle('Preview of your project (sandboxed)')).toBeInTheDocument();
    expect(useRunStore.getState().run.phase).toBe('running');
  });

  it('stops a running desktop preview when the pane closes', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<PreviewPane />);
    await user.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(useRunStore.getState().run.phase).toBe('running'));

    unmount();

    expect(useRunStore.getState().run.phase).toBe('stopped');
    expect(screen.queryByTitle('Preview of your project (sandboxed)')).not.toBeInTheDocument();
  });
});
