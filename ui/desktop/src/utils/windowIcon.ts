import manifest from '../branding/assets/manifest.json';

export function getWindowIconFilename(platform: string): string {
  return platform === 'win32' ? manifest.window.win32 : manifest.window.default;
}
