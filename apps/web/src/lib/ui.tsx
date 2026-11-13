import { formatMoney } from '@invoice/shared';
import { cloneElement, isValidElement, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from 'react';
import type { BadgeTone } from './ui-tokens';
import { useCurrency } from './use-currency';

/**
 * UI/UX-05: a small shared visual-hierarchy kit — page/section
 * headings, one consistent primary/secondary/danger button style,
 * a status badge, and a money formatter/renderer. Deliberately not a
 * full design-system framework: each piece exists only because the
 * same visual recipe was duplicated (with drifting padding/sizing)
 * across many files already; nothing here is speculative.
 */

// ---------------------------------------------------------------------------
// Page / section headings
// ---------------------------------------------------------------------------

/**
 * One page title per screen — ~24px/semibold/dark, per the report's
 * typography scale — with an optional helper subtitle and a primary
 * action slot that sits to the right on desktop and stacks cleanly on
 * mobile.
 */
export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action && <div className="flex shrink-0 flex-wrap gap-2">{action}</div>}
    </div>
  );
}

/** A sub-section heading within a page — ~16px/semibold, one notch below PageHeader. */
export function SectionHeading({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <h3 className={`text-base font-semibold text-slate-900 ${className}`}>{children}</h3>;
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-md px-4 py-2.5 text-sm font-medium transition-colors ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

/** The one solid, high-contrast action style for the primary action on a screen (Create invoice, Save, Record payment, Add customer…). */
export function PrimaryButton({ className = '', type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={`${BUTTON_BASE} bg-slate-900 text-white hover:bg-slate-700 focus-visible:outline-slate-900 ${className}`}
      {...props}
    />
  );
}

/** Lighter/outline treatment for secondary actions (Cancel, Filters…) — never competes visually with PrimaryButton. */
export function SecondaryButton({ className = '', type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={`${BUTTON_BASE} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 focus-visible:outline-slate-400 ${className}`}
      {...props}
    />
  );
}

/** Reserved for genuinely destructive actions (Delete, permanently delete, Deactivate) — must never be mistaken for a primary action. */
export function DangerButton({ className = '', type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={`${BUTTON_BASE} border border-red-300 bg-white text-red-700 hover:bg-red-50 focus-visible:outline-red-500 ${className}`}
      {...props}
    />
  );
}

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------

/**
 * A label + control + optional error/helper text, with consistent
 * spacing and a visible "(optional)" marker — matches the "clear
 * required/optional treatment" ask without a required/optional prop
 * pair that would just duplicate the HTML `required` attribute on the
 * control itself; callers already know if a field is required from
 * their own `required` prop on the input.
 */
export function FormField({
  label,
  htmlFor,
  optional,
  error,
  helperText,
  children,
}: {
  label: string;
  htmlFor: string;
  optional?: boolean;
  error?: string;
  helperText?: string;
  children: ReactNode;
}) {
  // UI/UX-09 Part 3: the error/helper text is programmatically
  // associated with the actual control (aria-describedby), not just
  // visually adjacent to it — and aria-invalid is set whenever this
  // field currently has an error, so assistive tech announces both
  // the moment the control receives focus. `children` is always
  // exactly one form control across every caller of this component,
  // so cloning it to add these two attributes never needs a more
  // invasive API change.
  const describedById = error || helperText ? `${htmlFor}-description` : undefined;
  const control =
    isValidElement(children) && describedById
      ? cloneElement(children as ReactElement<{ 'aria-invalid'?: boolean; 'aria-describedby'?: string }>, {
          'aria-invalid': error ? true : undefined,
          'aria-describedby': describedById,
        })
      : children;

  return (
    <div>
      <label htmlFor={htmlFor} className="block text-xs font-medium text-slate-600">
        {label}
        {optional && <span className="ml-1 font-normal text-slate-400">(optional)</span>}
      </label>
      <div className="mt-1">{control}</div>
      {error ? (
        <p id={describedById} className="mt-1 text-xs text-red-600">
          {error}
        </p>
      ) : helperText ? (
        <p id={describedById} className="mt-1 text-xs text-slate-400">
          {helperText}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status badges
// ---------------------------------------------------------------------------

const BADGE_TONE_CLASS: Record<BadgeTone, string> = {
  success: 'bg-green-50 text-green-700 ring-1 ring-inset ring-green-200',
  warning: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200',
  danger: 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200',
  neutral: 'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200',
  info: 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200',
};

/**
 * One consistent shape/padding/typography for every status pill in the
 * app (invoice payment status, invoice draft/issued/archived,
 * customer active/archived…). The *label text* is always the real
 * signal — color is reinforcement only, never the only way the status
 * is communicated.
 */
export function StatusBadge({ label, tone }: { label: string; tone: BadgeTone }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${BADGE_TONE_CLASS[tone]}`}>
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/**
 * Renders a stored decimal string as money — thousands-grouped, with
 * the active company's currency code prefixed (from CurrencyContext)
 * unless explicitly suppressed. Purely presentational: never changes
 * the underlying value, never used for anything fed back into a
 * calculation.
 */
export function MoneyText({
  value,
  showCurrency = true,
  className = '',
}: {
  value: string;
  showCurrency?: boolean;
  className?: string;
}) {
  const currencyCode = useCurrency();
  return <span className={`tabular-nums ${className}`}>{formatMoney(value, showCurrency ? currencyCode : undefined)}</span>;
}
