/**
 * Gilbert's local, read-only document preview service.
 *
 * Only the Electron main process can read local paths or launch converters.
 * No web service is started. Office files are converted to PDF in an isolated
 * temporary LibreOffice profile; Poppler rasterizes individual PDF pages.
 *
 * Register with the SAME main-window authorization function used by the
 * desktop's existing LAN authentication IPC. Never expose to MCP app frames.
 */
import { app, dialog, ipcMain } from 'electron';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type { GilbertPreviewResult } from './types';

const exec = promisify(execFile);
const MAX_SOURCE_BYTES = 40 * 1024 * 1024;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_PAGES = 350;
const MAX_OPEN_PREVIEWS = 10;

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
};

const OFFICE = new Set([
  '.pptx', '.ppt', '.odp',
  '.docx', '.doc', '.odt',
  '.xlsx', '.xls', '.ods',
]);

// Text and SVG/HTML are displayed literally, never executed in a web view.
const TEXT = new Set([
  '.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.jsonl', '.xml',
  '.html', '.htm', '.svg', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.log',
  '.py', '.ipynb', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css',
  '.sh', '.bat', '.ps1', '.sql', '.rs', '.cs', '.go', '.java', '.cpp', '.h',
]);

const SUPPORTED = new Set([...Object.keys(IMAGE_MIME), ...OFFICE, ...TEXT, '.pdf']);

type PreviewRecord = {
  id: string;
  ownerWebContentsId: number;
  name: string;
  original: string;
  kind: 'image' | 'text' | 'paged';
  pageCount: number;
  pdf?: string;
  tempDir?: string;
};

const opened = new Map<string, PreviewRecord>();

function libreOfficeCommand(): string {
  if (process.env.GILBERT_LIBREOFFICE_BIN) return process.env.GILBERT_LIBREOFFICE_BIN;
  if (process.platform === 'win32') {
    for (const root of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]) {
      if (!root) continue;
      const candidate = path.join(root, 'LibreOffice', 'program', 'soffice.exe');
      if (existsSync(candidate)) return candidate;
    }
    return 'soffice.exe';
  }
  return 'libreoffice';
}

function popplerCommand(name: 'pdfinfo' | 'pdftoppm'): string {
  const dir = process.env.GILBERT_POPPLER_BIN_DIR;
  const executable = process.platform === 'win32' ? `${name}.exe` : name;
  return dir ? path.join(dir, executable) : executable;
}

async function run(command: string, args: string[], timeout = 90000): Promise<string> {
  try {
    const result = await exec(command, args, {
      timeout,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    });
    return result.stdout;
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'ENOENT') {
      throw new Error(
        `${command} was not found. Install LibreOffice and Poppler ` +
        '(Ubuntu: sudo apt install libreoffice poppler-utils), or configure the ' +
        'GILBERT_LIBREOFFICE_BIN and GILBERT_POPPLER_BIN_DIR paths on Windows.'
      );
    }
    throw new Error(`Unable to render this file with ${path.basename(command)}: ${error.message}`);
  }
}

async function dispose(record: PreviewRecord): Promise<void> {
  opened.delete(record.id);
  if (record.tempDir) {
    await fs.rm(record.tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function render(record: PreviewRecord, page = 1): Promise<GilbertPreviewResult> {
  const requestedPage = Math.max(1, Math.min(record.pageCount, page));
  const common = {
    id: record.id,
    name: record.name,
    page: requestedPage,
    pageCount: record.pageCount,
  };
  if (record.kind === 'text') {
    return { ...common, kind: 'text', text: await fs.readFile(record.original, 'utf8') };
  }
  if (record.kind === 'image') {
    const mime = IMAGE_MIME[path.extname(record.original).toLowerCase()];
    const bytes = await fs.readFile(record.original);
    return { ...common, kind: 'image', dataUrl: `data:${mime};base64,${bytes.toString('base64')}` };
  }
  if (!record.pdf || !record.tempDir) throw new Error('This file preview has expired.');

  // Render one page on demand; never embed an active PDF, PPTX or Office document.
  const outputPrefix = path.join(record.tempDir, 'preview-page');
  await run(popplerCommand('pdftoppm'), [
    '-f', String(requestedPage), '-l', String(requestedPage),
    '-singlefile', '-scale-to', '1600', '-png', record.pdf, outputPrefix,
  ], 60000);
  const bytes = await fs.readFile(`${outputPrefix}.png`);
  return { ...common, kind: 'image', dataUrl: `data:image/png;base64,${bytes.toString('base64')}` };
}

async function openFile(filePath: string, ownerWebContentsId: number): Promise<GilbertPreviewResult> {
  if (typeof filePath !== 'string' || filePath.length > 4096 || !path.isAbsolute(filePath)) {
    throw new Error('Choose an absolute path to a local file.');
  }
  const absolute = await fs.realpath(filePath);
  const metadata = await fs.stat(absolute);
  const ext = path.extname(absolute).toLowerCase();
  if (!metadata.isFile() || !SUPPORTED.has(ext)) throw new Error('Unsupported file type.');
  if (metadata.size > MAX_SOURCE_BYTES) {
    throw new Error('File is larger than the 40 MB preview limit.');
  }
  if (TEXT.has(ext) && metadata.size > MAX_TEXT_BYTES) {
    throw new Error('Text previews are limited to 2 MB; open the file in an editor instead.');
  }
  const record: PreviewRecord = {
    id: randomUUID(),
    ownerWebContentsId,
    name: path.basename(absolute),
    original: absolute,
    kind: TEXT.has(ext) ? 'text' : IMAGE_MIME[ext] ? 'image' : 'paged',
    pageCount: 1,
  };
  try {
    if (record.kind === 'paged') {
      record.tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gilbert-preview-'));
      let pdf = absolute;
      if (OFFICE.has(ext)) {
        // A unique profile prevents conflicts with the user's running LibreOffice GUI.
        const profile = path.join(record.tempDir, 'libreoffice-profile');
        await run(libreOfficeCommand(), [
          `-env:UserInstallation=${pathToFileURL(profile).href}`,
          '--headless', '--convert-to', 'pdf', '--outdir', record.tempDir, absolute,
        ], 120000);
        pdf = path.join(record.tempDir, `${path.parse(absolute).name}.pdf`);
        await fs.access(pdf);
      }
      record.pdf = pdf;
      const info = await run(popplerCommand('pdfinfo'), [pdf], 30000);
      const pageCount = Number(info.match(/^Pages:\s*(\d+)/m)?.[1] ?? '0');
      if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > MAX_PAGES) {
        throw new Error(`This document exceeds the ${MAX_PAGES}-page preview limit.`);
      }
      record.pageCount = pageCount;
    }
    if (opened.size >= MAX_OPEN_PREVIEWS) {
      const oldest = opened.values().next().value as PreviewRecord | undefined;
      if (oldest) await dispose(oldest);
    }
    opened.set(record.id, record);
    return await render(record);
  } catch (err) {
    await dispose(record);
    throw err;
  }
}

function ownedPreview(
  event: IpcMainInvokeEvent,
  requireWindow: (event: IpcMainInvokeEvent) => BrowserWindow,
  id: unknown
): PreviewRecord {
  const win = requireWindow(event);
  if (typeof id !== 'string') throw new Error('Invalid preview identifier.');
  const record = opened.get(id);
  if (!record || record.ownerWebContentsId !== win.webContents.id) {
    throw new Error('This preview is no longer available.');
  }
  return record;
}

let registered = false;

export function registerGilbertFilePreviews(
  requireWindow: (event: IpcMainInvokeEvent) => BrowserWindow
): void {
  if (registered) return;
  registered = true;

  ipcMain.handle('gilbert-preview:choose', async (event): Promise<GilbertPreviewResult | null> => {
    const win = requireWindow(event);
    const result = await dialog.showOpenDialog(win, {
      title: 'Preview a local file in Gilbert',
      properties: ['openFile'],
      filters: [{
        name: 'Documents, images and source files',
        extensions: [...SUPPORTED].map((extension) => extension.slice(1)),
      }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return openFile(result.filePaths[0], win.webContents.id);
  });

  ipcMain.handle('gilbert-preview:open-path', async (event, filePath: unknown) => {
    const win = requireWindow(event);
    if (typeof filePath !== 'string' || filePath.length > 4096 || !path.isAbsolute(filePath)) {
      throw new Error('Only absolute local file paths may be previewed.');
    }
    // Agent text is untrusted. Never open an agent-suggested path without approval.
    const prompt = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['Cancel', 'Preview'],
      defaultId: 0,
      cancelId: 0,
      title: 'Preview local file?',
      message: 'Allow Gilbert to read and preview this local file?',
      detail: filePath,
    });
    if (prompt.response !== 1) return null;
    return openFile(filePath, win.webContents.id);
  });

  ipcMain.handle('gilbert-preview:page', async (event, id: unknown, page: unknown) => {
    const record = ownedPreview(event, requireWindow, id);
    if (typeof page !== 'number' || !Number.isInteger(page) || page < 1 || page > record.pageCount) {
      throw new Error('Invalid preview page number.');
    }
    return render(record, page);
  });

  ipcMain.handle('gilbert-preview:close', async (event, id: unknown) => {
    await dispose(ownedPreview(event, requireWindow, id));
  });

  app.on('before-quit', () => {
    for (const record of opened.values()) void dispose(record);
  });
}
