import { setupServer } from 'msw/node';

/** The mock API shared by all tests. Tests add handlers with `server.use(...)`. */
export const server = setupServer();
