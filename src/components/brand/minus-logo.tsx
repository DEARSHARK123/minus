import type { ImgHTMLAttributes } from 'react';

export type MinusLogoVariant = 'mark' | 'hero';

export type MinusLogoProps = Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  'src' | 'width' | 'height' | 'alt'
> & {
  /** `mark` = compact sidebar / chrome icon; `hero` = home empty-state with fireworks */
  variant?: MinusLogoVariant;
  size?: number;
  label?: string;
};

const SRC: Record<MinusLogoVariant, string> = {
  mark: '/brand/star-mark.png',
  hero: '/brand/star-hero.png',
};

/**
 * Product logo assets: doodle star mark (sidebar/avatars) and star + fireworks (home hero).
 * `MinusMark` also renders the same star mark for assistant avatars / status chrome.
 */
export function MinusLogo({
  variant = 'mark',
  size = 32,
  label,
  className,
  style,
  ...props
}: MinusLogoProps) {
  const accessibleLabel = label ?? props['aria-label'];
  const isDecorative = !accessibleLabel;

  return (
    // eslint-disable-next-line @next/next/no-img-element -- static brand asset; avoid layout shift from next/image config
    <img
      src={SRC[variant]}
      width={size}
      height={size}
      alt={isDecorative ? '' : accessibleLabel}
      role={isDecorative ? undefined : 'img'}
      aria-hidden={isDecorative ? true : undefined}
      draggable={false}
      className={['minus-logo', `minus-logo--${variant}`, className]
        .filter(Boolean)
        .join(' ')}
      style={{
        width: size,
        height: size,
        objectFit: 'contain',
        flexShrink: 0,
        ...style,
      }}
      {...props}
    />
  );
}

export default MinusLogo;
