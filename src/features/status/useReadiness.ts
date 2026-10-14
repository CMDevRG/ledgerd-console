import { useQuery } from '@tanstack/react-query';

import { getReadiness } from '../../api/endpoints';

/** Polls the API's readiness through the console server: is ledgerd up and able to reach its database? */
export function useReadiness() {
  return useQuery({
    queryKey: ['readiness'],
    queryFn: ({ signal }) => getReadiness(signal),
    refetchInterval: 10_000,
    retry: false,
  });
}
