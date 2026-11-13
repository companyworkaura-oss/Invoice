import type { Customer, Permission } from '@invoice/shared';
import { useEffect, useState } from 'react';
import { SuccessBanner } from '../../lib/AsyncState';
import { PageHeader, PrimaryButton } from '../../lib/ui';
import { useDocumentTitle } from '../../lib/use-document-title';
import { CustomerStatementView } from '../ledger/CustomerStatementView';
import * as customersApi from './api';
import { CustomerDetails } from './CustomerDetails';
import { CustomerForm } from './CustomerForm';
import { CustomerList } from './CustomerList';

type View =
  | { name: 'list' }
  | { name: 'details'; customer: Customer }
  | { name: 'form'; customer?: Customer }
  | { name: 'statement'; customer: Customer };

interface Props {
  permissions: Permission[];
  /**
   * UI/UX-01: set by InvoiceDetails' "View customer account" action
   * (via App.tsx's viewCustomerAccount) — jumps straight to that
   * customer's statement instead of the plain list. Same lifecycle as
   * PaymentsPage's `initialCustomerId`: the caller owns clearing it
   * (on company switch), so a repeated id doesn't need to re-fire
   * this effect, and leaving this tab and coming back doesn't jump
   * again on its own.
   */
  openCustomerId?: string;
}

export function CustomersPage({ permissions, openCustomerId }: Props) {
  useDocumentTitle('Customers');
  const [view, setView] = useState<View>({ name: 'list' });
  const [refreshToken, setRefreshToken] = useState(0);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!openCustomerId) return;
    customersApi
      .getCustomer(openCustomerId)
      .then((customer) => setView({ name: 'statement', customer }))
      .catch(() => undefined);
  }, [openCustomerId]);

  function refreshList() {
    setRefreshToken((t) => t + 1);
  }

  return (
    <div>
      <div className="print:hidden">
        <PageHeader
          title="Customers"
          subtitle="Everyone you bill, their contact details, and account balances"
          action={
            view.name === 'list' && (
              <PrimaryButton onClick={() => setView({ name: 'form' })}>Add customer</PrimaryButton>
            )
          }
        />
      </div>

      {successMessage && (
        <div className="mt-3">
          <SuccessBanner message={successMessage} onDismiss={() => setSuccessMessage(null)} />
        </div>
      )}

      <div className="mt-4 print:mt-0">
        {view.name === 'list' && (
          <CustomerList
            refreshToken={refreshToken}
            onSelect={(customer) => setView({ name: 'details', customer })}
            onAddCustomer={() => setView({ name: 'form' })}
          />
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
            onViewStatement={() => setView({ name: 'statement', customer: view.customer })}
            permissions={permissions}
          />
        )}

        {view.name === 'form' && (
          <CustomerForm
            customer={view.customer}
            onSaved={(customer) => {
              refreshList();
              setSuccessMessage(view.customer ? `Customer ${customer.name} updated.` : `Customer ${customer.name} created.`);
              setView({ name: 'details', customer });
            }}
            onCancel={() => setView(view.customer ? { name: 'details', customer: view.customer } : { name: 'list' })}
          />
        )}

        {view.name === 'statement' && (
          <CustomerStatementView customer={view.customer} onBack={() => setView({ name: 'details', customer: view.customer })} />
        )}
      </div>
    </div>
  );
}
