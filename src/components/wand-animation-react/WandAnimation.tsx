'use client';

import { useEffect, useRef } from 'react';
import type { AnimationItem } from 'lottie-web';

import wandAnimationData from './wand.json';

export type WandAnimationProps = {
  size?: number;
  className?: string;
  loop?: boolean;
  autoplay?: boolean;
};

export function WandAnimation({
  size = 48,
  className,
  loop = true,
  autoplay = true,
}: WandAnimationProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let animation: AnimationItem | null = null;

    async function loadAnimation() {
      try {
        const { default: lottie } = await import('lottie-web');
        const container = containerRef.current;

        if (cancelled || !container) {
          return;
        }

        animation = lottie.loadAnimation({
          container,
          renderer: 'svg',
          loop,
          autoplay,
          animationData: wandAnimationData,
        });
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load the wand animation', error);
        }
      }
    }

    void loadAnimation();

    return () => {
      cancelled = true;
      animation?.destroy();
    };
  }, [autoplay, loop]);

  return (
    <div
      ref={containerRef}
      className={className}
      aria-hidden="true"
      style={{ width: size, height: size }}
    />
  );
}
