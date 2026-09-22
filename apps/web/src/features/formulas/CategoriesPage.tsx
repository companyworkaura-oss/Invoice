import type { EmbroideryCategory } from '@invoice/shared';
import { useState } from 'react';
import { CategoryForm } from './CategoryForm';
import { CategoryList } from './CategoryList';

type View = { name: 'list' } | { name: 'form'; category?: EmbroideryCategory };

export function CategoriesPage() {
  const [view, setView] = useState<View>({ name: 'list' });
  const [refreshToken, setRefreshToken] = useState(0);

  function backToList() {
    setRefreshToken((t) => t + 1);
    setView({ name: 'list' });
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">Embroidery categories</h2>
        {view.name === 'list' && (
          <button
            type="button"
            onClick={() => setView({ name: 'form' })}
            className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:bg-slate-50"
          >
            New category
          </button>
        )}
      </div>

      <div className="mt-3">
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
