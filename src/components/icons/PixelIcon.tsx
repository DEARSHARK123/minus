import React from 'react';

export type PixelIconName =
  | 'action-check'
  | 'action-play'
  | 'action-plus'
  | 'action-x'
  | 'nav-feed'
  | 'nav-home'
  | 'nav-library'
  | 'nav-calendar'
  | 'nav-video'
  | 'nav-history'
  | 'nav-knowledge'
  | 'outline'
  | 'plan-diagnose'
  | 'plan-goal'
  | 'plan-propose'
  | 'plan-replan'
  | 'plan-skip'
  | 'search'
  | 'send'
  | 'session-done'
  | 'session-lock'
  | 'session-open'
  | 'sources'
  | 'upload'
  | 'warn';

interface PixelIconProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src' | 'width' | 'height'> {
  name: PixelIconName;
  size?: 16 | 32;
}

export default function PixelIcon({
  name,
  size = 16,
  className = '',
  style,
  ...props
}: PixelIconProps) {
  const src = `/icons/pixel/${name}-${size}.png`;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={name}
      width={size}
      height={size}
      className={`select-none inline-block ${className}`}
      style={{
        imageRendering: 'pixelated',
        ...style,
      }}
      {...props}
    />
  );
}
