export interface PanelOffset {
  x: number;
  y: number;
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Keeps a dragged panel this far from the edges of the stage. */
export const PANEL_MARGIN = 8;

/**
 * Limits a drag offset so the panel stays inside its container.
 *
 * `base` is the panel's box with no offset applied, `bounds` the container's.
 * A panel larger than the container is pinned to the top-left edge.
 */
export function clampPanelOffset(offset: PanelOffset, base: Box, bounds: Box): PanelOffset {
  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(value, Math.max(min, max)));

  return {
    x: clamp(
      offset.x,
      bounds.left + PANEL_MARGIN - base.left,
      bounds.left + bounds.width - PANEL_MARGIN - base.width - base.left,
    ),
    y: clamp(
      offset.y,
      bounds.top + PANEL_MARGIN - base.top,
      bounds.top + bounds.height - PANEL_MARGIN - base.height - base.top,
    ),
  };
}

const STORAGE_PREFIX = 'jarvis.panel-offset.v5.';

/** Last position the user left a panel in; `null` when none was saved. */
export function loadPanelOffset(id: string): PanelOffset | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + id);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PanelOffset>;
    if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
      return { x: parsed.x as number, y: parsed.y as number };
    }
  } catch {
    // Storage can be blocked or hold junk; start from the default spot.
  }
  return null;
}

export function savePanelOffset(id: string, offset: PanelOffset | null): void {
  try {
    if (offset) {
      window.localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(offset));
    } else {
      window.localStorage.removeItem(STORAGE_PREFIX + id);
    }
  } catch {
    // The position just will not be remembered.
  }
}
