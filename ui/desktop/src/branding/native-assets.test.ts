import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';

const mocks = vi.hoisted(() => ({
  app: { isPackaged: false, getAppPath: () => '/development/desktop' },
  image: { isEmpty: vi.fn(() => false), setTemplateImage: vi.fn() },
  createFromPath: vi.fn(),
}));
vi.mock('electron', () => ({
  app: mocks.app,
  nativeImage: { createFromPath: mocks.createFromPath },
}));

import { createBrandTrayImage, getBrandAssetPath, getTrayIconFilename } from './native-assets';

beforeEach(() => {
  mocks.app.isPackaged = false;
  vi.clearAllMocks();
  mocks.image.isEmpty.mockReturnValue(false);
  mocks.createFromPath.mockReturnValue(mocks.image);
});

describe('native branding artwork paths', () => {
  it('resolves development resources from the application directory instead of the shell directory', () => {
    expect(getBrandAssetPath('app.png')).toBe(
      path.join('/development/desktop', 'src', 'branding', 'assets', 'app.png')
    );
  });

  it('resolves packaged resources from the assets folder copied by Electron Forge', () => {
    mocks.app.isPackaged = true;
    const previous = Object.getOwnPropertyDescriptor(process, 'resourcesPath');
    Object.defineProperty(process, 'resourcesPath', {
      configurable: true,
      value: '/installed/resources',
    });
    try {
      expect(getBrandAssetPath('app.ico')).toBe(
        path.join('/installed/resources', 'assets', 'app.ico')
      );
    } finally {
      if (previous) Object.defineProperty(process, 'resourcesPath', previous);
      else Reflect.deleteProperty(process, 'resourcesPath');
    }
  });

  it.each([
    ['darwin', 'trayTemplate.png', 'tray-updateTemplate.png'],
    ['win32', 'tray.ico', 'tray-update.ico'],
    ['linux', 'tray.png', 'tray-update.png'],
  ])('selects normal and update artwork for %s', (platform, normal, update) => {
    expect(getTrayIconFilename(platform, false)).toBe(normal);
    expect(getTrayIconFilename(platform, true)).toBe(update);
  });

  it('loads the native tray image and rejects an empty image before tray construction', () => {
    expect(createBrandTrayImage()).toBe(mocks.image);
    expect(mocks.createFromPath).toHaveBeenCalledWith(
      getBrandAssetPath(getTrayIconFilename(process.platform, false))
    );
    mocks.image.isEmpty.mockReturnValue(true);
    expect(() => createBrandTrayImage()).toThrow('missing or unreadable');
  });
});
