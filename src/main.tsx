import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';

import { Providers, createQueryClient } from './app/Providers';
import { createAppRouter } from './app/router';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element');

createRoot(root).render(
  <StrictMode>
    <Providers client={createQueryClient()}>
      <RouterProvider router={createAppRouter()} />
    </Providers>
  </StrictMode>,
);
