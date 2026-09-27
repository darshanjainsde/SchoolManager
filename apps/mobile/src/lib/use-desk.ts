import { useQuery } from '@/lib/query';
import { type DeskMe } from '@/lib/sports-desk';

/** What this sports desk may do — `GET /sports/me`; the shell draws only those buttons. */
export function useDeskMe() {
  return useQuery<DeskMe>('/sports/me');
}
