import { describe, expect, it } from 'vitest';
import { getWindowIconFilename } from './windowIcon';

describe('getWindowIconFilename', () => {
  it.each([
    ['darwin', 'app.png'],
    ['win32', 'app.ico'],
    ['linux', 'app.png'],
  ] as const)('uses the native icon for %s', (platform, expected) => {
    expect(getWindowIconFilename(platform)).toBe(expected);
  });

  it('uses the cross-platform PNG fallback', () => {
    expect(getWindowIconFilename('freebsd')).toBe('app.png');
  });
});
