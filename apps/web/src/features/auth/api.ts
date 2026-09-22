import type { Me } from '@invoice/shared';
import { api } from '../../lib/api';

export interface RegisterInput {
  companyName: string;
  fullName: string;
  email: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export const register = (input: RegisterInput) => api<{ ok: true }>('/auth/register', {
  method: 'POST',
  body: JSON.stringify(input),
});

export const login = (input: LoginInput) => api<{ ok: true }>('/auth/login', {
  method: 'POST',
  body: JSON.stringify(input),
});

export const logout = () => api<{ ok: true }>('/auth/logout', { method: 'POST' });

export const fetchMe = () => api<Me>('/auth/me');
