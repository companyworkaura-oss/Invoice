import { useState } from 'react';
import { ApiError } from '../../lib/api';
import * as companyApi from './api';

interface Props {
  logoUrl: string | null;
  canEdit: boolean;
  onUploaded: (logoUrl: string | null) => void;
}

export function LogoUploader({ logoUrl, canEdit, onUploaded }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const updated = await companyApi.uploadLogo(file);
      onUploaded(updated.logoUrl);
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-slate-50">
        {logoUrl ? (
          <img src={logoUrl} alt="Company logo" className="h-full w-full object-contain" />
        ) : (
          <span className="text-xs text-slate-400">No logo</span>
        )}
      </div>
      {canEdit && (
        <label className="cursor-pointer rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
          {uploading ? 'Uploading…' : logoUrl ? 'Change logo' : 'Upload logo'}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            onChange={handleChange}
            disabled={uploading}
            className="hidden"
          />
        </label>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
