import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { getJson } from '../../api/http';

const readySchema = z.object({ status: z.literal('ready') });

/** Polls /readyz: is the API up and able to reach its database? */
export function useReadiness() {
  return useQuery({
    queryKey: ['readiness'],
    queryFn: ({ signal }) => getJson('/readyz', readySchema, signal),
    refetchInterval: 10_000,
    retry: false,
  });
}
