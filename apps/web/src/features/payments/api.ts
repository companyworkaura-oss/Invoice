import type { Payment, PaymentMethod } from '@invoice/shared';
import { api } from '../../lib/api';

export interface PaymentInput {
  customerId: string;
  amount: string;
  date?: string;
  paymentMethod: PaymentMethod;
  reference?: string;
  notes?: string;
}

export interface ListParams {
  customerId?: string;
}

export function listPayments(params: ListParams = {}) {
  const qs = params.customerId ? `?customerId=${encodeURIComponent(params.customerId)}` : '';
  return api<Payment[]>(`/payments${qs}`);
}

export const getPayment = (id: string) => api<Payment>(`/payments/${id}`);

export const createPayment = (input: PaymentInput) => api<Payment>('/payments', {
  method: 'POST',
  body: JSON.stringify(input),
});
