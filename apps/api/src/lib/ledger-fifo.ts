/**
 * The one authoritative "FIFO payment allocation" SQL fragment (F04).
 *
 * The rule: a customer's payments/credits pay off their *oldest* debt
 * first. To compute that, every positive-debit ledger entry —
 * OPENING_BALANCE, INVOICE, and any debit ADJUSTMENT — must be
 * windowed together, newest first, into `cumulative_before`: the
 * total of every entry strictly newer than this one. Narrowing which
 * rows take part in that window (e.g. to `type = 'INVOICE'` only)
 * before the window is computed is the F04 bug: it silently drops
 * newer debit adjustments from the running sum, so a draft invoice a
 * payment already fully covered looks unpaid again once a later,
 * unrelated debit adjustment raises the customer's balance — even
 * though that adjustment is a newer debt and, under FIFO, sits behind
 * the invoice in the queue, not in front of it.
 *
 * Any filtering to a specific entry type (an invoice's own paid
 * amount, or a count of unpaid invoices) must happen *after* this
 * fragment, in the outer query — never inside it.
 *
 * Every consumer of "how much has actually been paid" — the invoice
 * list, a single invoice's own paid amount, and the dashboard's
 * unpaid/partial count — builds on this exact fragment rather than a
 * hand-rolled copy, so they can never drift out of sync with each
 * other again.
 *
 * `companyIdParam`/`customerIdParam` are the caller's own `$N`
 * placeholders (not renumbered here), so this can be spliced into
 * queries with different parameter lists/positions. Pass
 * `customerIdParam` to scope both CTEs to one customer (cheaper, and
 * what a single-invoice lookup needs); omit it to compute every
 * customer's FIFO allocation in one query (what a company-wide list
 * or count needs).
 */
export function fifoPaidCtes(companyIdParam: string, customerIdParam?: string): string {
  const customerFilter = customerIdParam ? ` AND le.customer_id = ${customerIdParam}` : '';
  return `
    balances AS (
      SELECT customer_id, COALESCE(SUM(debit) - SUM(credit), 0) AS current_balance
        FROM ledger_entries
       WHERE company_id = ${companyIdParam}${customerIdParam ? ` AND customer_id = ${customerIdParam}` : ''}
       GROUP BY customer_id
    ),
    ordered AS (
      SELECT
        le.customer_id,
        le.type,
        le.reference_id AS invoice_id,
        le.debit,
        SUM(le.debit) OVER (
          PARTITION BY le.customer_id
          ORDER BY le.created_at DESC, le.id DESC
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ) AS cumulative_before
      FROM ledger_entries le
      WHERE le.company_id = ${companyIdParam} AND le.debit > 0${customerFilter}
    )
  `;
}
