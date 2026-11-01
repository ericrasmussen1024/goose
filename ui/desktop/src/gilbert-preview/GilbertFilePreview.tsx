/** Gilbert Desktop: local document and slide previews within the chat window. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Message } from '../types/message';
import type { GilbertPreviewResult } from './types';

// Previewable paths mentioned by the assistant, never loaded without user approval.
const EXT = '(?:pptx|ppt|odp|docx|doc|odt|xlsx|xls|ods|pdf|png|jpe?g|gif|webp|bmp|txt|md|markdown|csv|tsv|json|jsonl|xml|html|htm|svg|ya?ml|toml|log|py|ipynb|tsx?|jsx?|css|sh|sql|cs|go|java|cpp|rs)';

function pathsFromMessages(messages: Message[]): string[] {
  const paths = new Set<string>();
  const recent = messages.filter((m) => m.role === 'assistant').slice(-16);
  for (const message of recent) {
    for (const block of message.content) {
      if (block.type !== 'text') continue;
      // Limit scanning so a very long response does not block the chat renderer.
      const value = block.text.slice(-30000);
      const patterns = [
        // Absolute paths inside Markdown links or inline code may contain spaces.
        new RegExp('\\]\\((/[^\\n)]+\\.' + EXT + ')\\)', 'gi'),
        new RegExp('`(/[^`\\n]+\\.' + EXT + ')`', 'gi'),
        new RegExp('`([A-Za-z]:\\\\[^`\\n]+\\.' + EXT + ')`', 'gi'),
        // Unquoted path tokens.
        new RegExp('(?:^|\\s)(/[^\\s<>"`]+\\.' + EXT + ')(?=$|[\\s)\\],;])', 'gi'),
        new RegExp('(?:^|\\s)([A-Za-z]:\\\\[^\\s<>"`]+\\.' + EXT + ')(?=$|[\\s)\\],;])', 'gi'),
      ];
      for (const pattern of patterns) {
        for (const match of value.matchAll(pattern)) {
          const filePath = match[1];
          if (filePath && filePath.length <= 1024) paths.add(filePath);
        }
      }
    }
  }
  return [...paths].slice(-8).reverse();
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function GilbertFilePreview({ messages }: { messages: Message[] }) {
  const [preview, setPreview] = useState<GilbertPreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const active = useRef<GilbertPreviewResult | null>(null);
  const requestSequence = useRef(0);
  const choices = useMemo(() => pathsFromMessages(messages), [messages]);

  const close = useCallback(() => {
    requestSequence.current += 1;
    const previous = active.current;
    active.current = null;
    setPreview(null);
    setError(null);
    setBusy(false);
    if (previous) void window.electron.gilbertPreviewClose(previous.id).catch(() => {});
  }, []);

  useEffect(() => () => {
    // Release temporary previews when switching conversations.
    const previous = active.current;
    if (previous) void window.electron.gilbertPreviewClose(previous.id).catch(() => {});
  }, []);

  const open = useCallback(async (filePath?: string) => {
    const sequence = ++requestSequence.current;
    setBusy(true);
    setError(null);
    try {
      const result = filePath
        ? await window.electron.gilbertPreviewPath(filePath)
        : await window.electron.gilbertPreviewChoose();
      if (sequence !== requestSequence.current) {
        if (result) void window.electron.gilbertPreviewClose(result.id).catch(() => {});
        return;
      }
      if (result) {
        const previous = active.current;
        active.current = result;
        setPreview(result);
        if (previous) void window.electron.gilbertPreviewClose(previous.id).catch(() => {});
      }
    } catch (err) {
      if (sequence === requestSequence.current) setError(errorText(err));
    } finally {
      if (sequence === requestSequence.current) setBusy(false);
    }
  }, []);

  const goToPage = useCallback(async (page: number) => {
    const current = active.current;
    if (!current || busy || page < 1 || page > current.pageCount) return;
    const sequence = ++requestSequence.current;
    setBusy(true);
    setError(null);
    try {
      const result = await window.electron.gilbertPreviewPage(current.id, page);
      if (sequence === requestSequence.current) {
        active.current = result;
        setPreview(result);
      }
    } catch (err) {
      if (sequence === requestSequence.current) setError(errorText(err));
    } finally {
      if (sequence === requestSequence.current) setBusy(false);
    }
  }, [busy]);

  useEffect(() => {
    if (!preview && !error) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (!preview || busy || event.target instanceof HTMLInputElement) return;
      if (event.key === 'ArrowRight' && preview.page < preview.pageCount) {
        event.preventDefault();
        void goToPage(preview.page + 1);
      } else if (event.key === 'ArrowLeft' && preview.page > 1) {
        event.preventDefault();
        void goToPage(preview.page - 1);
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [preview, error, busy, close, goToPage]);

  return (
    <>
      {/* Place the control beneath Gilbert's existing top navigation, not over the title. */}
      <div className="no-drag absolute right-4 top-[51px] z-[65] flex max-w-[60%] items-center gap-2">
        {choices.length > 0 && (
          <select
            aria-label="Choose a local file mentioned in this chat"
            className="max-w-[175px] rounded-md border border-border-primary bg-background-primary px-2 py-1 text-xs text-text-primary"
            defaultValue=""
            disabled={busy}
            onChange={(event) => {
              const filePath = event.target.value;
              event.target.value = '';
              if (filePath) void open(filePath);
            }}
          >
            <option value="">Files in chat…</option>
            {choices.map((filePath) => (
              <option value={filePath} key={filePath} title={filePath}>
                {filePath.split(/[\\/]/).pop() || filePath}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={() => void open()}
          disabled={busy}
          className="rounded-md border border-border-primary bg-background-primary px-3 py-1 text-xs font-medium text-text-primary hover:bg-background-secondary disabled:opacity-50"
          title="Preview a local PowerPoint, PDF, Word, Excel, image, or text file"
        >
          {busy ? 'Opening…' : 'Preview file'}
        </button>
      </div>

      {preview && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Gilbert document preview"
          className="fixed inset-0 z-[9999] flex flex-col bg-background-primary text-text-primary"
        >
          <div className="no-drag flex h-14 shrink-0 items-center gap-3 border-b border-border-primary px-5">
            <strong className="min-w-0 flex-1 truncate text-sm">
              {preview?.name ?? 'Could not preview file'}
            </strong>
            {preview && preview.pageCount > 1 && (
              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  aria-label="Previous page"
                  disabled={busy || preview.page <= 1}
                  onClick={() => void goToPage(preview.page - 1)}
                  className="rounded border border-border-primary px-3 py-1 disabled:opacity-30"
                >
                  ←
                </button>
                <span>
                  {/\.(pptx?|odp)$/i.test(preview.name) ? 'Slide' : 'Page'}{' '}
                  {preview.page} / {preview.pageCount}
                </span>
                <button
                  type="button"
                  aria-label="Next page"
                  disabled={busy || preview.page >= preview.pageCount}
                  onClick={() => void goToPage(preview.page + 1)}
                  className="rounded border border-border-primary px-3 py-1 disabled:opacity-30"
                >
                  →
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={close}
              className="rounded border border-border-primary px-3 py-1 text-sm hover:bg-background-secondary"
            >
              Close ✕
            </button>
          </div>
          {error && (
            <div role="alert" className="mx-5 mt-3 rounded-md border border-red-400 p-3 text-sm text-red-600">
              {error}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-auto bg-background-secondary p-4 text-center">
            {preview?.kind === 'image' && preview.dataUrl && (
              <img
                src={preview.dataUrl}
                alt={`${preview.name}, page ${preview.page}`}
                className="mx-auto h-auto max-h-full max-w-full object-contain shadow-lg"
              />
            )}
            {preview?.kind === 'text' && (
              <pre className="mx-auto max-w-6xl whitespace-pre-wrap break-words rounded-lg bg-background-primary p-5 text-left font-mono text-xs leading-relaxed select-text">
                {preview.text}
              </pre>
            )}
            {busy && <p role="status" className="pt-3 text-sm">Rendering locally…</p>}
          </div>
        </div>
      )}
      {!preview && error && (
        <div className="absolute right-4 top-[85px] z-[70] max-w-sm rounded-md border border-red-400 bg-background-primary p-3 text-xs text-red-600" role="alert">
          {error}
          <button type="button" onClick={() => setError(null)} className="ml-3 underline">Dismiss</button>
        </div>
      )}
    </>
  );
}
