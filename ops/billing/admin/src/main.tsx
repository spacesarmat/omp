import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AdminRouter } from './router';
import { LiveProvider } from './lib/live';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <LiveProvider>
        <AdminRouter />
      </LiveProvider>
    </QueryClientProvider>
  </StrictMode>,
);
