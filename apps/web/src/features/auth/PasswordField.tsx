import { useId, useState } from 'react';

interface Props {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  required?: boolean;
  minLength?: number;
  /** Shown under the field, e.g. the actual backend password-length rule for a new password — never shown only after a failed submit. */
  helperText?: string;
  error?: string;
}

/**
 * UI/UX-09 Part 8: a show/hide toggle (with an accessible, state-
 * aware label — "Show password"/"Hide password", not a bare icon),
 * the correct `autocomplete` token for the field's actual purpose
 * (`current-password` for signing in, `new-password` for creating an
 * account — never the bare, ambiguous `password` browsers otherwise
 * guess at), and the same error/helper-text association `FormField`
 * (lib/ui.tsx) uses elsewhere, inlined here since this is the one
 * password-specific control in the app.
 */
export function PasswordField({ id, label, value, onChange, autoComplete, required, minLength, helperText, error }: Props) {
  const [visible, setVisible] = useState(false);
  const generatedId = useId();
  const descriptionId = error || helperText ? generatedId : undefined;

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      <div className="relative mt-1">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          required={required}
          minLength={minLength}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={descriptionId}
          className="w-full rounded-md border border-slate-300 px-3 py-2 pr-16 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-400"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 px-3 text-xs font-medium text-slate-500 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400"
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>
      {error ? (
        <p id={descriptionId} className="mt-1 text-xs text-red-600">
          {error}
        </p>
      ) : helperText ? (
        <p id={descriptionId} className="mt-1 text-xs text-slate-500">
          {helperText}
        </p>
      ) : null}
    </div>
  );
}
