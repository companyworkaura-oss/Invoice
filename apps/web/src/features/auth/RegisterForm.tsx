import { useState } from 'react';
import { ApiError } from '../../lib/api';
import { PrimaryButton } from '../../lib/ui';
import * as authApi from './api';
import { PasswordField } from './PasswordField';

interface Props {
  onRegistered: () => void;
  onSwitchToLogin: () => void;
}

// UI/UX-09 Part 9: the actual backend rule (apps/api's auth.routes.ts:
// requireString(body, 'password', { min: 8, max: 128 })) — shown here
// so a user finds out before submitting, not after a rejected request.
const PASSWORD_MIN_LENGTH = 8;

export function RegisterForm({ onRegistered, onSwitchToLogin }: Props) {
  const [companyName, setCompanyName] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await authApi.register({ companyName, fullName, email, password });
      onRegistered();
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="reg-company" className="block text-sm font-medium text-slate-700">
          Company name
        </label>
        <input
          id="reg-company"
          type="text"
          required
          autoComplete="organization"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-400"
        />
      </div>
      <div>
        <label htmlFor="reg-name" className="block text-sm font-medium text-slate-700">
          Your name
        </label>
        <input
          id="reg-name"
          type="text"
          required
          autoComplete="name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-400"
        />
      </div>
      <div>
        <label htmlFor="reg-email" className="block text-sm font-medium text-slate-700">
          Email
        </label>
        <input
          id="reg-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-400"
        />
      </div>
      <PasswordField
        id="reg-password"
        label="Password"
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
        required
        minLength={PASSWORD_MIN_LENGTH}
        helperText={`Must be at least ${PASSWORD_MIN_LENGTH} characters.`}
      />
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <PrimaryButton type="submit" disabled={submitting} className="w-full">
        {submitting ? 'Creating account…' : 'Create account'}
      </PrimaryButton>
      <p className="text-center text-sm text-slate-500">
        Already have an account?{' '}
        <button type="button" onClick={onSwitchToLogin} className="font-medium text-slate-900 underline">
          Sign in
        </button>
      </p>
    </form>
  );
}
