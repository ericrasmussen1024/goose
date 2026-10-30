import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IntlProvider } from 'react-intl';
import BrandAnimation from './BrandAnimation';
import { brandAssets } from './assets';
import LoadingGoose from '../components/LoadingGoose';
import { ChatState } from '../types/chatState';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('application artwork animation', () => {
  it('cycles through every configured frame at 155 ms and cancels its timer on unmount', () => {
    vi.useFakeTimers();
    const { container, unmount } = render(<BrandAnimation />);
    const img = container.querySelector('img')!;
    expect(img.getAttribute('src')).toBe(brandAssets.frames[0]);
    for (let index = 1; index <= brandAssets.frames.length; index++) {
      act(() => vi.advanceTimersByTime(155));
      expect(img.getAttribute('src')).toBe(brandAssets.frames[index % brandAssets.frames.length]);
    }
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses the static icon and starts no animation timer when motion is reduced', () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const { container } = render(<BrandAnimation />);
    expect(container.querySelector('img')!.getAttribute('src')).toBe(brandAssets.icon);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('responds to a live change in the system motion setting', () => {
    vi.useFakeTimers();
    let listener = () => {};
    const media = {
      matches: false,
      addEventListener: vi.fn((_name, callback) => {
        listener = callback;
      }),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal('matchMedia', () => media);
    const { container, unmount } = render(<BrandAnimation />);
    act(() => {
      media.matches = true;
      listener();
    });
    expect(container.querySelector('img')!.getAttribute('src')).toBe(brandAssets.icon);
    expect(vi.getTimerCount()).toBe(0);
    unmount();
    expect(media.removeEventListener).toHaveBeenCalled();
  });

  it.each(Object.values(ChatState))('uses shared artwork for the %s chat state', (chatState) => {
    vi.useFakeTimers();
    const { container } = render(
      <IntlProvider locale="en">
        <LoadingGoose chatState={chatState} />
      </IntlProvider>
    );
    const src = container.querySelector('img')!.getAttribute('src');
    const inactive = chatState === ChatState.Idle || chatState === ChatState.WaitingForUserInput;
    expect(src).toBe(inactive ? brandAssets.icon : brandAssets.frames[0]);
  });
});
