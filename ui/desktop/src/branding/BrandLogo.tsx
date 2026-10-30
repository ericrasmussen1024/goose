import BrandIcon from './BrandIcon';
import { cn } from '../utils';

export default function BrandLogo({
  className = '',
  size = 'default',
  hover = true,
}: {
  className?: string;
  size?: 'default' | 'small';
  hover?: boolean;
}) {
  return (
    <BrandIcon
      className={cn(
        'shrink-0',
        size === 'small' ? 'w-8 h-8' : 'w-16 h-16',
        hover && 'motion-safe:transition-transform motion-safe:hover:scale-105',
        className
      )}
    />
  );
}
