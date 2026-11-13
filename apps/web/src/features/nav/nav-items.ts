/**
 * UI/UX-06: the pure "what shows where" decision behind AppNav.tsx —
 * split out so the nav structure itself (item order/labels/grouping,
 * the mobile primary/"More" split, permission-based visibility) is
 * unit-testable without a React renderer, same convention as this
 * repo's other extracted decision logic (invoice-list-filters.ts,
 * list-view-state.ts).
 */
export interface NavItem {
  path: string;
  label: string;
}

/**
 * The five everyday destinations, in the report's own recommended
 * order — always visible on desktop; the first four also form
 * mobile's compact primary row (see MOBILE_PRIMARY_NAV_ITEMS below).
 * "Rates & Categories" replaces the old "Categories" label to match
 * CategoriesPage's own UI/UX-05 page title.
 */
export const PRIMARY_NAV_ITEMS: readonly NavItem[] = [
  { path: '/dashboard', label: 'Dashboard' },
  { path: '/invoices', label: 'Invoices' },
  { path: '/customers', label: 'Customers' },
  { path: '/payments', label: 'Payments' },
  { path: '/categories', label: 'Rates & Categories' },
];

/** Mobile's compact primary row — the four most common destinations, never off-screen. */
export const MOBILE_PRIMARY_NAV_ITEMS: readonly NavItem[] = PRIMARY_NAV_ITEMS.slice(0, 4);

/** The one primary item that doesn't fit mobile's compact row — folded into "More" there, never hidden entirely. */
export const MOBILE_MORE_ONLY_ITEM: NavItem = PRIMARY_NAV_ITEMS[4];

/**
 * Company settings replaces "Overview" everywhere — there is no
 * longer a second item competing with Dashboard as a "home" screen.
 * It stays unconditionally visible, matching the existing (UI/UX-05
 * and earlier) `/settings` route, which already shows read-only
 * content to any authenticated member regardless of permission —
 * company.manage/company.deactivate/company.delete each already gate
 * their own specific actions *inside* that page (CompanyProfilePanel,
 * CompanyDangerZone), so nothing new is hidden or exposed by listing
 * the page itself unconditionally here. Activity log stays gated by
 * `audit.view`, exactly as it already was before this task.
 */
export function getSecondaryNavItems(showActivityLog: boolean): NavItem[] {
  const items: NavItem[] = [{ path: '/settings', label: 'Company settings' }];
  if (showActivityLog) items.push({ path: '/activity', label: 'Activity log' });
  return items;
}
