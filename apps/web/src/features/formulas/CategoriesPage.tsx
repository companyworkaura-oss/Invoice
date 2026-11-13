import type { EmbroideryCategory } from '@invoice/shared';
import { useState } from 'react';
import { PageHeader, PrimaryButton } from '../../lib/ui';
import { useDocumentTitle } from '../../lib/use-document-title';
import { CategoryForm } from './CategoryForm';
import { CategoryList } from './CategoryList';

type View = { name: 'list' } | { name: 'form'; category?: EmbroideryCategory };

export function CategoriesPage() {
  useDocumentTitle('Rates & Categories');
  const [view, setView] = useState<View>({ name: 'list' });
  const [refreshToken, setRefreshToken] = useState(0);

  function backToList() {
    setRefreshToken((t) => t + 1);
    setView({ name: 'list' });
  }

  return (
    <div>
      <PageHeader
        title="Rates & categories"
        subtitle="Embroidery categories, default rates, and pricing formulas"
        action={
          view.name === 'list' && <PrimaryButton onClick={() => setView({ name: 'form' })}>New category</PrimaryButton>
        }
      />

      <div className="mt-4">
        {view.name === 'list' && (
          <CategoryList refreshToken={refreshToken} onSelect={(category) => setView({ name: 'form', category })} />
        )}

        {view.name === 'form' && (
          <CategoryForm category={view.category} onSaved={backToList} onCancel={() => setView({ name: 'list' })} />
        )}
      </div>
    </div>
  );
}
