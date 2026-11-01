/**
 * Validate that a privileged IPC request came from a trusted Gilbert desktop
 * renderer, not from an embedded MCP app, a child frame, or a window that has
 * navigated to another page.
 *
 * A successful check establishes sender provenance only. Authentication and
 * authorization for a particular operation still belong to its IPC handler.
 */
import { BrowserWindow, type IpcMainInvokeEvent } from 'electron';

/** Compare the exact renderer document URL, allowing only HashRouter changes. */
function isTrustedAppDocument(actual: string, expected: URL): boolean {
  try {
    const actualUrl = new URL(actual);
    const expectedUrl = new URL(expected.href);

    // Gilbert uses HashRouter to move between /pair, /settings, /standalone-app,
    // etc. A fragment change is not a navigation to a different document.
    actualUrl.hash = '';
    expectedUrl.hash = '';

    // Exact URL equality is important for file:// URLs: comparing origins
    // would accept *every* local file, because file origins are opaque.
    return actualUrl.href === expectedUrl.href;
  } catch {
    return false;
  }
}

export function requireDesktopRendererWindow(
  event: IpcMainInvokeEvent,
  isRegisteredWindow: (window: BrowserWindow) => boolean,
  trustedAppUrl: URL
): BrowserWindow {
  const sender = event.sender;
  const senderFrame = event.senderFrame;

  // WebContents may have subframes (including untrusted MCP Apps). These
  // must never be allowed to invoke privileged main-process handlers.
  if (!sender || sender.isDestroyed() || !senderFrame || senderFrame !== sender.mainFrame) {
    throw new Error('IPC request was not sent by the main Gilbert renderer frame.');
  }

  const window = BrowserWindow.fromWebContents(sender);
  if (
    !window ||
    window.isDestroyed() ||
    window.webContents !== sender ||
    !isRegisteredWindow(window)
  ) {
    throw new Error('IPC request was not sent by a registered Gilbert desktop window.');
  }

  // Check both the frame origin at the time it sent the IPC message and the
  // owning WebContents' current URL. This blocks navigated/embedded content.
  if (
    !isTrustedAppDocument(senderFrame.url, trustedAppUrl) ||
    !isTrustedAppDocument(sender.getURL(), trustedAppUrl)
  ) {
    throw new Error('IPC request originated outside the Gilbert desktop application.');
  }

  return window;
}
