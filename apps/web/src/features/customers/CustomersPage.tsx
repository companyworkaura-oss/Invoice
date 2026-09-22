import type { Customer } from '@invoice/shared';
import { useState } from 'react';
import { CustomerDetails } from './CustomerDetails';
import { CustomerForm } from './CustomerForm';
import { CustomerList } from './CustomerList';

type View = { name: 'list' } | { name: 'details'; customer: Customer } | { name: 'form'; customer?: Customer };

export function CustomersPage() {
  const [view, setView] = useState<View>({ name: 'list' });
  const [refreshToken, setRefreshToken] = useState(0);

  function refreshList() {
    setRefreshToken((t) => t + 1);
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">Customers</h2>
        {view.name === 'list' && (
          <button
            type="button"
            onClick={() => setView({ name: 'form' })}
            className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:bg-slate-50"
          >
            New customer
          </button>
        )}
      </div>

      <div className="mt-3">
        {view.name === 'list' && (
          <CustomerList refreshToken={refreshToken} onSelect={(customer) => setView({ name: 'details', customer })} />
        )}

        {view.name === 'details' && (
          <CustomerDetails
            customer={view.customer}
            onBack={() => {
              refreshList();
              setView({ name: 'list' });
            }}
            onEdit={() => setView({ name: 'form', customer: view.customer })}
            onArchived={(customer) => setView({ name: 'details', customer })}
          />
        )}

        {view.name === 'form' && (
          <CustomerForm
            customer={view.customer}
            onSaved={(customer) => {
              refreshList();
              setView({ name: 'details', customer });
            }}
            onCancel={() => setView(view.customer ? { name: 'details', customer: view.customer } : { name: 'list' })}
          />
        )}
      </div>
    </div>
  );
}
