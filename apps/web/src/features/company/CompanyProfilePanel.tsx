import type { CompanyProfile, Permission } from '@invoice/shared';
import { useEffect, useState } from 'react';
import * as companyApi from './api';
import { CompanyProfileForm } from './CompanyProfileForm';
import { LogoUploader } from './LogoUploader';

interface Props {
  permissions: Permission[];
}

/**
 * The parent mounts this with `key={companyId}` so switching the active
 * company remounts it — state starts fresh at `null` instead of us having
 * to reset it imperatively inside an effect.
 */
export function CompanyProfilePanel({ permissions }: Props) {
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const canEdit = permissions.includes('company.manage');

  useEffect(() => {
    companyApi.fetchProfile().then(setProfile).catch(() => setProfile(null));
  }, []);

  if (!profile) {
    return <p className="mt-4 text-sm text-slate-400">Loading profile…</p>;
  }

  return (
    <div className="mt-4 border-t border-slate-200 pt-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Company profile</p>
      <div className="mt-2">
        <LogoUploader
          logoUrl={profile.logoUrl}
          canEdit={canEdit}
          onUploaded={(logoUrl) => setProfile((p) => (p ? { ...p, logoUrl } : p))}
        />
      </div>
      <CompanyProfileForm profile={profile} canEdit={canEdit} onSaved={setProfile} />
    </div>
  );
}
