import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatDashboardPeriodLabel } from '../src/features/dashboard/period-label.js';

// UI/UX-07 Part 5: a visible, human-readable label for the dashboard's
// selected period, distinguishing "today" / "this period" from a
// current-balance figure that has no period at all.

test('a single-day period (range=today) formats as one date', () => {
  assert.equal(formatDashboardPeriodLabel({ range: 'today', from: '2026-11-12', to: '2026-11-12' }), '12 Nov 2026');
});

test('a whole calendar month (range=month) formats as "Mon Year"', () => {
  assert.equal(formatDashboardPeriodLabel({ range: 'month', from: '2026-11-01', to: '2026-11-30' }), 'Nov 2026');
  assert.equal(formatDashboardPeriodLabel({ range: 'month', from: '2026-02-01', to: '2026-02-28' }), 'Feb 2026');
});

test('a custom range that is not a whole month formats as "DD Mon – DD Mon YYYY"', () => {
  assert.equal(
    formatDashboardPeriodLabel({ range: 'custom', from: '2026-10-28', to: '2026-11-03' }),
    '28 Oct 2026 – 03 Nov 2026',
  );
});

test('a custom range starting on the 1st but not ending on the last day is not treated as a whole month', () => {
  assert.equal(
    formatDashboardPeriodLabel({ range: 'custom', from: '2026-11-01', to: '2026-11-15' }),
    '01 Nov 2026 – 15 Nov 2026',
  );
});

test('a custom range spanning years still formats both full dates', () => {
  assert.equal(
    formatDashboardPeriodLabel({ range: 'custom', from: '2025-12-20', to: '2026-01-05' }),
    '20 Dec 2025 – 05 Jan 2026',
  );
});
