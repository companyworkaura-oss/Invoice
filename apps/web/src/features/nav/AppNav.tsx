import { NavLink } from 'react-router-dom';
import { Dropdown } from '../../lib/Dropdown';
import { getSecondaryNavItems, MOBILE_MORE_ONLY_ITEM, MOBILE_PRIMARY_NAV_ITEMS, PRIMARY_NAV_ITEMS } from './nav-items';

interface Props {
  /** Company settings is always reachable (matches this app's existing, unguarded /settings route — it already shows read-only content to anyone, not just company.manage). Activity log stays gated the same way it already was. */
  showActivityLog: boolean;
  onLogout: () => void;
}

const DESKTOP_LINK_CLASS =
  'rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400';
const DESKTOP_LINK_ACTIVE = 'bg-slate-900 text-white';
const DESKTOP_LINK_INACTIVE = 'text-slate-600 hover:bg-slate-100 hover:text-slate-900';

const DESKTOP_SECONDARY_LINK_CLASS =
  'rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400';
const DESKTOP_SECONDARY_ACTIVE = 'bg-slate-100 text-slate-900';
const DESKTOP_SECONDARY_INACTIVE = 'text-slate-500 hover:bg-slate-50 hover:text-slate-700';

/**
 * UI/UX-06 Part 3/4/5: the app's main navigation — a top nav rather
 * than a sidebar (the existing top nav is simple and already works;
 * converting the whole shell to a sidebar for this task alone would be
 * redesigning for its own sake, which the task explicitly says not to
 * do). Desktop shows every everyday destination at equal, prominent
 * weight, with Company settings/Activity log visually demoted
 * (smaller, muted, grouped separately) rather than competing with them
 * — "Dashboard" and "Overview" used to read as two competing home
 * screens; now there is exactly one primary row and one clearly
 * secondary one. Mobile swaps the old horizontally-overflowing strip
 * (later destinations could scroll off-screen, invisible) for a
 * bounded row of the four most common destinations plus a "More"
 * menu — nothing is ever off-screen or hidden without a visible way to
 * reach it.
 */
export function AppNav({ showActivityLog, onLogout }: Props) {
  const secondaryItems = getSecondaryNavItems(showActivityLog);

  return (
    <nav aria-label="Main" className="mt-4 border-b border-slate-200 print:hidden">
      {/* Desktop / tablet: both rows always fully visible, no horizontal scroll needed — five primary items plus a short secondary group comfortably fit from `sm:` up. */}
      <div className="hidden items-center justify-between gap-3 pb-2 sm:flex">
        <div className="flex flex-wrap gap-1">
          {PRIMARY_NAV_ITEMS.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => `${DESKTOP_LINK_CLASS} ${isActive ? DESKTOP_LINK_ACTIVE : DESKTOP_LINK_INACTIVE}`}
            >
              {item.label}
            </NavLink>
          ))}
        </div>
        <div className="flex shrink-0 gap-1 border-l border-slate-200 pl-3">
          {secondaryItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `${DESKTOP_SECONDARY_LINK_CLASS} ${isActive ? DESKTOP_SECONDARY_ACTIVE : DESKTOP_SECONDARY_INACTIVE}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      </div>

      {/* Mobile: a bounded row — Dashboard/Invoices/Customers/Payments always visible, never off-screen; everything else (Rates & Categories, Company settings, Activity log, Log out) lives in "More". */}
      <div className="flex items-center justify-between gap-1 pb-2 sm:hidden">
        {MOBILE_PRIMARY_NAV_ITEMS.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `flex-1 rounded-md px-1 py-2.5 text-center text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400 ${
                isActive ? DESKTOP_LINK_ACTIVE : DESKTOP_LINK_INACTIVE
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
        <Dropdown
          align="right"
          trigger={(toggle, open) => (
            <button
              type="button"
              onClick={toggle}
              aria-expanded={open}
              aria-haspopup="menu"
              className="shrink-0 rounded-md px-2 py-2.5 text-center text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400"
            >
              More ▾
            </button>
          )}
        >
          {(close) => (
            <div className="w-56">
              <NavLink
                to={MOBILE_MORE_ONLY_ITEM.path}
                onClick={close}
                className={({ isActive }) =>
                  `block px-3 py-2 text-sm ${isActive ? 'bg-slate-50 font-semibold text-slate-900' : 'text-slate-700 hover:bg-slate-50'}`
                }
              >
                {MOBILE_MORE_ONLY_ITEM.label}
              </NavLink>
              <div className="my-1 border-t border-slate-100" />
              {secondaryItems.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  onClick={close}
                  className={({ isActive }) =>
                    `block px-3 py-2 text-sm ${isActive ? 'bg-slate-50 font-semibold text-slate-900' : 'text-slate-700 hover:bg-slate-50'}`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
              <div className="my-1 border-t border-slate-100" />
              <button
                type="button"
                onClick={() => {
                  close();
                  onLogout();
                }}
                className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
              >
                Log out
              </button>
            </div>
          )}
        </Dropdown>
      </div>
    </nav>
  );
}
