import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  getSecondaryNavItems,
  MOBILE_MORE_ONLY_ITEM,
  MOBILE_PRIMARY_NAV_ITEMS,
  PRIMARY_NAV_ITEMS,
} from '../src/features/nav/nav-items.js';

// UI/UX-06: the pure nav structure behind AppNav.tsx — item order,
// labels, the mobile primary/"More" split, and permission-based
// secondary-item visibility, all testable without a React renderer.

test('UI/UX-06: primary nav is the report\'s recommended order, with Rates & Categories replacing the old "Categories" label', () => {
  assert.deepEqual(
    PRIMARY_NAV_ITEMS.map((i) => i.label),
    ['Dashboard', 'Invoices', 'Customers', 'Payments', 'Rates & Categories'],
  );
  assert.deepEqual(
    PRIMARY_NAV_ITEMS.map((i) => i.path),
    ['/dashboard', '/invoices', '/customers', '/payments', '/categories'],
  );
});

test('UI/UX-06: mobile\'s compact primary row is exactly the first four primary items — never off-screen, never scrolled', () => {
  assert.deepEqual(
    MOBILE_PRIMARY_NAV_ITEMS.map((i) => i.label),
    ['Dashboard', 'Invoices', 'Customers', 'Payments'],
  );
});

test('UI/UX-06: the one primary item mobile folds into "More" is Rates & Categories — present, not dropped', () => {
  assert.equal(MOBILE_MORE_ONLY_ITEM.label, 'Rates & Categories');
  assert.equal(MOBILE_MORE_ONLY_ITEM.path, '/categories');
});

test('UI/UX-06: "Overview" is gone — Company settings is the one and only settings destination, and it is never named "Overview"', () => {
  const allLabels = [...PRIMARY_NAV_ITEMS.map((i) => i.label), ...getSecondaryNavItems(true).map((i) => i.label)];
  assert.ok(!allLabels.includes('Overview'), 'no nav item should be labeled "Overview" anywhere');
  assert.ok(getSecondaryNavItems(true).some((i) => i.label === 'Company settings'));
  assert.ok(getSecondaryNavItems(false).some((i) => i.label === 'Company settings'));
});

test('UI/UX-06: Dashboard is the one and only home-screen destination — no second competing entry', () => {
  const allLabels = [...PRIMARY_NAV_ITEMS.map((i) => i.label), ...getSecondaryNavItems(true).map((i) => i.label)];
  assert.equal(allLabels.filter((l) => l === 'Dashboard').length, 1);
});

test('UI/UX-06: Company settings is always listed, regardless of permission', () => {
  assert.deepEqual(getSecondaryNavItems(false).map((i) => i.label), ['Company settings']);
});

test('UI/UX-06: Activity log is listed only when the caller says the viewer has audit.view', () => {
  assert.deepEqual(getSecondaryNavItems(true).map((i) => i.label), ['Company settings', 'Activity log']);
  assert.ok(!getSecondaryNavItems(false).map((i) => i.label).includes('Activity log'));
});
