import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import {
  clampPanelOffset,
  loadPanelOffset,
  savePanelOffset,
  type Box,
  type PanelOffset,
} from '../lib/panel-drag';

const ORIGIN: PanelOffset = { x: 0, y: 0 };

function toBox(rect: DOMRect): Box {
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

/**
 * Lets a HUD panel be dragged by its header with the mouse, touch or pen.
 *
 * The panel keeps its CSS position; the drag only adds an offset, exposed as
 * the `--drag-x` / `--drag-y` variables, so the entrance animation is not
 * disturbed. The offset is clamped to the panel's container, remembered per
 * `id`, and a double click on the header puts the panel back in place.
 */
export function useDraggablePanel(id: string, active: boolean) {
  const panelRef = useRef<HTMLElement | null>(null);
  const [offset, setOffset] = useState<PanelOffset>(() => loadPanelOffset(id) ?? ORIGIN);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    from: PanelOffset;
    base: Box;
    bounds: Box;
  } | null>(null);
  const latest = useRef(offset);
  latest.current = offset;

  /** The panel's box as if no offset were applied, plus its container's box. */
  const measure = useCallback(() => {
    const panel = panelRef.current;
    const parent = panel?.offsetParent;
    if (!panel || !parent) return null;
    const rect = panel.getBoundingClientRect();
    const base = {
      left: rect.left - latest.current.x,
      top: rect.top - latest.current.y,
      width: rect.width,
      height: rect.height,
    };
    return { base, bounds: toBox(parent.getBoundingClientRect()) };
  }, []);

  // A smaller window can leave a remembered position off screen: pull it back.
  useEffect(() => {
    if (!active) return;
    const keepInside = () => {
      const measured = measure();
      if (!measured) return;
      const next = clampPanelOffset(latest.current, measured.base, measured.bounds);
      if (next.x !== latest.current.x || next.y !== latest.current.y) setOffset(next);
    };
    const frame = window.requestAnimationFrame(keepInside);
    window.addEventListener('resize', keepInside);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', keepInside);
    };
  }, [active, measure]);

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0 || (event.target as HTMLElement).closest('button, a')) return;
      const measured = measure();
      if (!measured) return;

      // Bring this panel in front of the other one.
      document.querySelectorAll<HTMLElement>('.mail-panel').forEach((el) => {
        el.style.zIndex = el === panelRef.current ? '8' : '7';
      });

      drag.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        from: latest.current,
        ...measured,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
    },
    [measure],
  );

  const onPointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const next = clampPanelOffset(
      {
        x: current.from.x + event.clientX - current.startX,
        y: current.from.y + event.clientY - current.startY,
      },
      current.base,
      current.bounds,
    );
    // Update the ref now: the pointer can be released before React re-renders,
    // and the saved position must be the last one the user saw.
    latest.current = next;
    setOffset(next);
  }, []);

  const endDrag = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      drag.current = null;
      setDragging(false);
      savePanelOffset(id, latest.current);
    },
    [id],
  );

  const reset = useCallback(() => {
    setOffset(ORIGIN);
    savePanelOffset(id, null);
  }, [id]);

  const style = {
    '--drag-x': `${offset.x}px`,
    '--drag-y': `${offset.y}px`,
  } as CSSProperties;

  return {
    panelRef,
    dragging,
    style,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onDoubleClick: reset,
    },
  };
}
