import type { Me } from '@invoice/shared';
import { useEffect, useState } from 'react';
import * as authApi from './features/auth/api';
import { LoginForm } from './features/auth/LoginForm';
import { RegisterForm } from './features/auth/RegisterForm';
import { CompanySwitcher } from './features/companies/CompanySwitcher';
import { CompanyProfilePanel } from './features/company/CompanyProfilePanel';
import { CustomersPage } from './features/customers/CustomersPage';
import { CategoriesPage } from './features/formulas/CategoriesPage';

type AuthView = 'login' | 'register';
type DashboardTab = 'overview' | 'customers' | 'categories';

function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined); // undefined = still checking
  const [authView, setAuthView] = useState<AuthView>('login');
  const [showProfile, setShowProfile] = useState(false);
  const [tab, setTab] = useState<DashboardTab>('overview');

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
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-2xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between">
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

        <div className="mt-4 flex gap-4 border-b border-slate-200">
          {(['overview', 'customers', 'categories'] as const).map((t) => (
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

        {tab === 'overview' && (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setShowProfile((s) => !s)}
              className="text-sm font-medium text-slate-900 underline"
            >
              {showProfile ? 'Hide company profile' : 'Company profile'}
            </button>
            {showProfile && <CompanyProfilePanel key={me.company.id} role={me.role} />}

            <CompanySwitcher activeCompanyId={me.company.id} onSwitched={refreshMe} />
          </div>
        )}

        {tab === 'customers' && (
          <div className="mt-4">
            <CustomersPage key={me.company.id} />
          </div>
        )}

        {tab === 'categories' && (
          <div className="mt-4">
            <CategoriesPage key={me.company.id} />
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
