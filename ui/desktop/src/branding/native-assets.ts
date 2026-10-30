import { app, nativeImage } from 'electron';
import path from 'node:path';
import manifest from './assets/manifest.json';

export function getBrandAssetPath(filename: string): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'assets', filename)
    : path.join(app.getAppPath(), 'src', 'branding', 'assets', filename);
}

export function getTrayIconFilename(platform: string, hasUpdate: boolean): string {
  const icons = hasUpdate ? manifest.trayUpdate : manifest.tray;
  return icons[platform as keyof typeof icons] || icons.default;
}

export function createBrandTrayImage(hasUpdate = false) {
  const image = nativeImage.createFromPath(
    getBrandAssetPath(getTrayIconFilename(process.platform, hasUpdate))
  );
  if (image.isEmpty()) throw new Error('Application tray artwork is missing or unreadable.');
  if (process.platform === 'darwin') image.setTemplateImage(true);
  return image;
}
