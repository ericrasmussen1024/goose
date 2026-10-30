import { useEffect, useState } from 'react';
import { brandAssets } from './assets';

export default function BrandAnimation({
  className = '',
  size = 28,
  frameMs = brandAssets.frameMs,
}: {
  className?: string;
  size?: number;
  frameMs?: number;
}) {
  const [frame, setFrame] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  );

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!media) return;
    const change = () => setReducedMotion(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);

  useEffect(() => {
    if (reducedMotion) return;
    const timer = window.setInterval(() => {
      setFrame((current) => (current + 1) % brandAssets.frames.length);
    }, frameMs);
    return () => window.clearInterval(timer);
  }, [frameMs, reducedMotion]);

  return (
    <img
      src={reducedMotion ? brandAssets.icon : brandAssets.frames[frame]}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      draggable={false}
      className={className}
      style={{ imageRendering: brandAssets.imageRendering, objectFit: 'contain', display: 'block' }}
    />
  );
}
