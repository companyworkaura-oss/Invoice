import type { Me } from '@invoice/shared';
import { useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useSearchParams } from 'react-router-dom';
import { AuditLogPage } from './features/audit/AuditLogPage';
import * as authApi from './features/auth/api';
import { LoginForm } from './features/auth/LoginForm';
import { RegisterForm } from './features/auth/RegisterForm';
import { CompanySwitcher } from './features/companies/CompanySwitcher';
import { CompanyDangerZone } from './features/company/CompanyDangerZone';
import { CompanyProfilePanel } from './features/company/CompanyProfilePanel';
import { CustomersPage } from './features/customers/CustomersPage';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { CategoriesPage } from './features/formulas/CategoriesPage';
import { InvoicesPage } from './features/invoices/InvoicesPage';
import { PaymentsPage } from './features/payments/PaymentsPage';

type AuthView = 'login' | 'register';

/**
 * UI/UX-03 Part 1: one real route per major screen (previously plain
 * `tab` local state — a refresh always landed back on Dashboard, and
 * nothing about "which screen" survived in the URL at all). Nested
 * `/invoices/*` routes are handled inside InvoicesPage itself (list,
 * detail, new, quick, edit — see that file). Customers/Payments/
 * Categories/Settings/Activity get one top-level route each; their
 * own internal navigation (customer detail/edit/statement, the
 * payments "new payment" form) stays local component state, same as
 * before — nothing in this task's acceptance scenarios needs those
 * sub-screens individually addressable by URL, and adding that for
 * every screen here would be over-engineering a task scoped around
 * invoices specifically.
 */
const NAV_ITEMS = [
  { path: '/dashboard', label: 'Dashboard' },
  { path: '/settings', label: 'Overview' },
  { path: '/customers', label: 'Customers' },
  { path: '/categories', label: 'Categories' },
  { path: '/invoices', label: 'Invoices' },
  { path: '/payments', label: 'Payments' },
] as const;

function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined); // undefined = still checking
  const [authView, setAuthView] = useState<AuthView>('login');
  const [showProfile, setShowProfile] = useState(false);

  function refreshMe() {
    authApi
      .fetchMe()
      .then(setMe)
      .catch(() => setMe(null));
  }

  useEffect(refreshMe, []);

  // Collapse the profile panel whenever the active company changes —
  // switching companies (or logging out and back in: `me?.company.id`
  // always passes through undefined first, so that counts as a
  // change too, even into the same company) must never leave a
  // previous company's profile panel open.
  //
  // Adjusted during render rather than in a useEffect — the
  // React-recommended way to reset state in response to a prop/value
  // changing ("Adjusting state when a prop changes" in the React
  // docs): a *state* variable (never a ref) tracks the last-seen
  // company id, and setState is called conditionally, right here, so
  // this resets in the very same render the company id changes in.
  const [lastSeenCompanyId, setLastSeenCompanyId] = useState(me?.company.id);
  if (lastSeenCompanyId !== me?.company.id) {
    setLastSeenCompanyId(me?.company.id);
    setShowProfile(false);
  }

  async function handleLogout() {
    await authApi.logout().catch(() => undefined);
    setMe(null);
  }

  if (me === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-400">Loading…</div>
    );
  }

  if (!me) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">Embroidery Billing</h1>
          <p className="mt-1 mb-6 text-sm text-slate-500">
            {authView === 'login' ? 'Sign in to your account' : 'Create your account'}
          </p>
          {authView === 'login' ? (
            <LoginForm onLoggedIn={refreshMe} onSwitchToRegister={() => setAuthView('register')} />
          ) : (
            <RegisterForm onRegistered={refreshMe} onSwitchToLogin={() => setAuthView('login')} />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-2 sm:p-3 md:p-4 lg:p-6 print:min-h-0 print:bg-white print:p-0">
      {/*
        This whole shell — header, tabs, card framing — is the app
        chrome, never the printable document itself: every "Print" or
        "Download PDF" button lives several component layers below
        here (invoice templates, the statement print document), so
        hiding/neutralizing it here is the one place that keeps the
        company-name/logout row and tab bar out of every print job,
        instead of each individual page having to remember to escape
        it. The card's padding/border/shadow/max-width are print-reset
        too — on screen they frame the app, but printed they'd just be
        extra blank margin around the actual A4 page.

        The card's width is deliberately responsive, not a flat
        max-w-5xl (1024px): max-w-[1400px] gives wide desktop/large-
        desktop screens (1366/1920px) real room for the invoice table,
        filters, and action menus, while w-full + mx-auto still lets it
        shrink to fill a phone/tablet viewport edge-to-edge (minus the
        outer page padding) instead of ever overflowing it.
      */}
      <div className="mx-auto w-full max-w-[1400px] rounded-lg border border-slate-200 bg-white p-3 sm:p-4 lg:p-6 shadow-sm print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <div className="flex items-start justify-between print:hidden">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">{me.company.name}</h1>
            <p className="text-sm text-slate-500">
              {me.fullName} · {me.role}
            </p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="shrink-0 rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:bg-slate-50"
          >
            Log out
          </button>
        </div>

        <div className="mt-4 flex gap-4 overflow-x-auto border-b border-slate-200 print:hidden">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `-mb-px shrink-0 border-b-2 px-1 pb-2 text-sm font-medium ${
                  isActive ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
          {me.permissions.includes('audit.view') && (
            <NavLink
              to="/activity"
              className={({ isActive }) =>
                `-mb-px shrink-0 border-b-2 px-1 pb-2 text-sm font-medium ${
                  isActive ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700'
                }`
              }
            >
              Audit
            </NavLink>
          )}
        </div>

        <div className="mt-4 print:mt-0">
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage key={me.company.id} />} />
            <Route
              path="/settings"
              element={
                <div>
                  <button
                    type="button"
                    onClick={() => setShowProfile((s) => !s)}
                    className="text-sm font-medium text-slate-900 underline"
                  >
                    {showProfile ? 'Hide company profile' : 'Company profile'}
                  </button>
                  {showProfile && <CompanyProfilePanel key={`profile-${me.company.id}`} permissions={me.permissions} />}

                  <CompanyDangerZone
                    key={`danger-${me.company.id}`}
                    companyName={me.company.name}
                    permissions={me.permissions}
                    onCompanyChanged={refreshMe}
                  />

                  <CompanySwitcher activeCompanyId={me.company.id} onSwitched={refreshMe} />
                </div>
              }
            />
            <Route path="/customers/*" element={<CustomersRoute key={me.company.id} permissions={me.permissions} />} />
            <Route path="/categories" element={<CategoriesPage key={me.company.id} />} />
            <Route path="/invoices/*" element={<InvoicesPage key={me.company.id} permissions={me.permissions} />} />
            <Route path="/payments" element={<PaymentsRoute key={me.company.id} permissions={me.permissions} />} />
            {me.permissions.includes('audit.view') && <Route path="/activity" element={<AuditLogPage key={me.company.id} />} />}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}

/**
 * UI/UX-01's "View customer account" action (from an invoice's
 * Customer Account panel) now just navigates to
 * `/customers?openCustomerId=...` instead of threading a prop through
 * App.tsx's own state — the query param is this route's entire input,
 * read once here rather than passed down as a stateful prop kept in
 * sync by hand.
 */
function CustomersRoute({ permissions }: { permissions: Me['permissions'] }) {
  const [params] = useSearchParams();
  return <CustomersPage permissions={permissions} openCustomerId={params.get('openCustomerId') ?? undefined} />;
}

/** Same pattern as CustomersRoute, for the existing "View payments" shortcut (`?customerId=`). */
function PaymentsRoute({ permissions }: { permissions: Me['permissions'] }) {
  const [params] = useSearchParams();
  return <PaymentsPage permissions={permissions} initialCustomerId={params.get('customerId') ?? undefined} />;
}

export default App;
