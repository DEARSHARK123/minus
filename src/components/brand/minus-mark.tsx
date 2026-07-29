import type { CSSProperties, HTMLAttributes } from 'react';

export type MinusMarkProps = Omit<
  HTMLAttributes<HTMLSpanElement>,
  'children'
> & {
  size?: number;
  animated?: boolean;
  thinking?: boolean;
  label?: string;
  /** Kept for API compat with former SVG usage; ignored (raster mark). */
  width?: number | string;
  height?: number | string;
};

const STAR_MARK_SRC = '/brand/star-mark.png';

/**
 * Product mark used for assistant avatars and chrome.
 * Renders the doodle star brand asset (replaces the old minus-bar SVG).
 */
export function MinusMark({
  size = 32,
  animated,
  thinking = false,
  label,
  className,
  width,
  height,
  style,
  ...props
}: MinusMarkProps) {
  const isAnimated = animated ?? thinking;
  const accessibleLabel = label ?? props['aria-label'];
  const resolvedSize =
    typeof width === 'number'
      ? width
      : typeof height === 'number'
        ? height
        : size;

  const wrapStyle: CSSProperties = {
    width: resolvedSize,
    height: resolvedSize,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    lineHeight: 0,
    ...style,
  };

  return (
    <span
      role={accessibleLabel ? 'img' : undefined}
      aria-label={accessibleLabel}
      aria-hidden={accessibleLabel ? undefined : true}
      className={['minus-mark', isAnimated ? 'minus-mark--animated' : '', className]
        .filter(Boolean)
        .join(' ')}
      style={wrapStyle}
      {...props}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- static brand mark */}
      <img
        src={STAR_MARK_SRC}
        alt=""
        width={resolvedSize}
        height={resolvedSize}
        draggable={false}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          display: 'block',
        }}
      />
    </span>
  );
}

export default MinusMark;
