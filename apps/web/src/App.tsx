import { useEffect, useState } from 'react';
import { api } from './lib/api';

type ApiStatus = 'checking' | 'up' | 'down';

function App() {
  const [status, setStatus] = useState<ApiStatus>('checking');

  useEffect(() => {
    api<{ ok: boolean }>('/health')
      .then(() => setStatus('up'))
      .catch(() => setStatus('down'));
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="max-w-sm w-full rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">Embroidery Billing</h1>
        <p className="mt-1 text-sm text-slate-500">Phase 1 foundation</p>
        <div className="mt-4 flex items-center gap-2 text-sm">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              status === 'up' ? 'bg-emerald-500' : status === 'down' ? 'bg-red-500' : 'bg-slate-300'
            }`}
          />
          <span className="text-slate-600">
            API: {status === 'checking' ? 'checking…' : status === 'up' ? 'connected' : 'unreachable'}
          </span>
        </div>
      </div>
    </div>
  );
}

export default App;
