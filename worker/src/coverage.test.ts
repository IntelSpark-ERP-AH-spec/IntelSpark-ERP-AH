import { coverageReport } from './coverage';
import { describe, expect, it } from 'vitest';

describe('frontend Worker coverage gate', () => {
  it('covers all P0 P1 P2 frontend routes', () => {
    const report = coverageReport(['P0', 'P1', 'P2']);
    expect(report.missing, JSON.stringify(report.missing, null, 2)).toEqual([]);
    expect(report.byPriority.P0.percent).toBe(100);
    expect(report.byPriority.P1.percent).toBe(100);
    expect(report.byPriority.P2.percent).toBe(100);
  });
});
