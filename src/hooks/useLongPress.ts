import { useEffect, useRef, type TouchEvent } from "react";

export interface LongPressOptions {
  delayMs?: number;
  moveTolerancePx?: number;
}

export interface LongPressHandlers {
  onTouchStart: (event: TouchEvent<HTMLElement>) => void;
  onTouchMove: (event: TouchEvent<HTMLElement>) => void;
  onTouchEnd: (event: TouchEvent<HTMLElement>) => void;
  onTouchCancel: (event: TouchEvent<HTMLElement>) => void;
}

export interface LongPressResult extends LongPressHandlers {
  /**
   * Returns true once when the last touch sequence was a long press or a
   * scroll, so the following synthetic `click` can be ignored.
   */
  shouldSuppressClick: () => boolean;
}

/**
 * Touch-only long-press detector for a single element.
 *
 * Fires after `delayMs` (default 450 ms) if the finger moved no more than
 * `moveTolerancePx` (default 10 px). Any larger movement cancels the timer so
 * the platform can scroll the list. Mouse and keyboard input are untouched.
 */
export function useLongPress(
  onLongPress: () => void,
  { delayMs = 450, moveTolerancePx = 10 }: LongPressOptions = {},
): LongPressResult {
  const timerRef = useRef<number | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const longPressFiredRef = useRef(false);
  const movedRef = useRef(false);
  const callbackRef = useRef(onLongPress);

  useEffect(() => {
    callbackRef.current = onLongPress;
  }, [onLongPress]);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => clearTimer, []);

  return {
    onTouchStart: (event) => {
      const touch = event.touches[0];
      if (!touch) return;
      if (event.touches.length > 1) {
        clearTimer();
        return;
      }
      clearTimer();
      longPressFiredRef.current = false;
      movedRef.current = false;
      startRef.current = { x: touch.clientX, y: touch.clientY };
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        longPressFiredRef.current = true;
        callbackRef.current();
      }, delayMs);
    },

    onTouchMove: (event) => {
      const start = startRef.current;
      const touch = event.touches[0];
      if (!start || !touch) return;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (Math.hypot(dx, dy) > moveTolerancePx) {
        movedRef.current = true;
        clearTimer();
        startRef.current = null;
      }
    },

    onTouchEnd: (event) => {
      clearTimer();
      startRef.current = null;
      // Mark the sequence as consumed so `onClick` ignores the synthetic click
      // that Android dispatches after touchend.
      if (longPressFiredRef.current) event.preventDefault();
    },

    onTouchCancel: () => {
      clearTimer();
      startRef.current = null;
    },

    shouldSuppressClick: () => {
      const suppressed = longPressFiredRef.current || movedRef.current;
      longPressFiredRef.current = false;
      movedRef.current = false;
      return suppressed;
    },
  };
}
