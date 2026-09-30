import type { Me } from '@invoice/shared';
import { useEffect, useState } from 'react';
import { AuditLogPage } from './features/audit/AuditLogPage';
import * as authApi from './features/auth/api';
import { LoginForm } from './features/auth/LoginForm';
import { RegisterForm } from './features/auth/RegisterForm';
import { CompanySwitcher } from './features/companies/CompanySwitcher';
import { CompanyProfilePanel } from './features/company/CompanyProfilePanel';
import { CustomersPage } from './features/customers/CustomersPage';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { CategoriesPage } from './features/formulas/CategoriesPage';
import { InvoicesPage } from './features/invoices/InvoicesPage';
import { PaymentsPage } from './features/payments/PaymentsPage';

type AuthView = 'login' | 'register';
type DashboardTab = 'dashboard' | 'overview' | 'customers' | 'categories' | 'invoices' | 'payments' | 'audit';

function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined); // undefined = still checking
  const [authView, setAuthView] = useState<AuthView>('login');
  const [showProfile, setShowProfile] = useState(false);
  const [tab, setTab] = useState<DashboardTab>('dashboard');

  function refreshMe() {
    authApi
      .fetchMe()
      .then(setMe)
      .catch(() => setMe(null));
  }

  useEffect(refreshMe, []);

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
    <div className="min-h-screen bg-slate-50 p-6 print:min-h-0 print:bg-white print:p-0">
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
      */}
      <div className="mx-auto max-w-5xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none">
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

        <div className="mt-4 flex gap-4 border-b border-slate-200 print:hidden">
          {(
            [
              'dashboard',
              'overview',
              'customers',
              'categories',
              'invoices',
              'payments',
              ...(me.permissions.includes('audit.view') ? (['audit'] as const) : []),
            ] as const
          ).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`-mb-px border-b-2 px-1 pb-2 text-sm font-medium capitalize ${
                tab === t ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === 'dashboard' && (
          <div className="mt-4 print:mt-0">
            <DashboardPage key={me.company.id} />
          </div>
        )}

        {tab === 'overview' && (
          <div className="mt-4 print:mt-0">
            <button
              type="button"
              onClick={() => setShowProfile((s) => !s)}
              className="text-sm font-medium text-slate-900 underline"
            >
              {showProfile ? 'Hide company profile' : 'Company profile'}
            </button>
            {showProfile && <CompanyProfilePanel key={me.company.id} permissions={me.permissions} />}

            <CompanySwitcher activeCompanyId={me.company.id} onSwitched={refreshMe} />
          </div>
        )}

        {tab === 'customers' && (
          <div className="mt-4 print:mt-0">
            <CustomersPage key={me.company.id} permissions={me.permissions} />
          </div>
        )}

        {tab === 'categories' && (
          <div className="mt-4 print:mt-0">
            <CategoriesPage key={me.company.id} />
          </div>
        )}

        {tab === 'invoices' && (
          <div className="mt-4 print:mt-0">
            <InvoicesPage key={me.company.id} permissions={me.permissions} />
          </div>
        )}

        {tab === 'payments' && (
          <div className="mt-4 print:mt-0">
            <PaymentsPage key={me.company.id} permissions={me.permissions} />
          </div>
        )}

        {tab === 'audit' && me.permissions.includes('audit.view') && (
          <div className="mt-4 print:mt-0">
            <AuditLogPage key={me.company.id} />
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
