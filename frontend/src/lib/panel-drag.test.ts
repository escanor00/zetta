import { describe, expect, it } from 'vitest';
import { clampPanelOffset, PANEL_MARGIN } from './panel-drag';

const bounds = { left: 0, top: 0, width: 1000, height: 600 };
const base = { left: 100, top: 80, width: 300, height: 200 };

describe('clampPanelOffset', () => {
  it('leaves an offset that keeps the panel inside untouched', () => {
    expect(clampPanelOffset({ x: 50, y: 40 }, base, bounds)).toEqual({ x: 50, y: 40 });
  });

  it('stops the panel at the top-left edges with a margin', () => {
    expect(clampPanelOffset({ x: -900, y: -900 }, base, bounds)).toEqual({
      x: PANEL_MARGIN - base.left,
      y: PANEL_MARGIN - base.top,
    });
  });

  it('stops the panel at the bottom-right edges with a margin', () => {
    expect(clampPanelOffset({ x: 9000, y: 9000 }, base, bounds)).toEqual({
      x: 1000 - PANEL_MARGIN - base.width - base.left,
      y: 600 - PANEL_MARGIN - base.height - base.top,
    });
  });

  it('pins a panel larger than the stage to the top-left', () => {
    const huge = { left: 0, top: 0, width: 1400, height: 900 };
    expect(clampPanelOffset({ x: 200, y: 200 }, huge, bounds)).toEqual({
      x: PANEL_MARGIN,
      y: PANEL_MARGIN,
    });
  });
});
