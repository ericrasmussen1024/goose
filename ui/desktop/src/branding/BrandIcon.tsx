import type { ComponentPropsWithoutRef } from 'react';
import { brandAssets } from './assets';

type Props = Omit<ComponentPropsWithoutRef<'img'>, 'src'>;

export default function BrandIcon({ alt = '', style, ...props }: Props) {
  return (
    <img
      {...props}
      src={brandAssets.icon}
      alt={alt}
      draggable={false}
      style={{ imageRendering: brandAssets.imageRendering, objectFit: 'contain', ...style }}
    />
  );
}
