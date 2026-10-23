'use client';
import { useQuery } from '@tanstack/react-query';
import { promoterApi, type PromoterMe } from '@/lib/promoter-session';

/** The promoter's me-record, shared by every page under /promoter. */
export function usePromoterMe() {
  return useQuery({ queryKey: ['promoter-me'], queryFn: () => promoterApi.get<PromoterMe>('/promoter/me'), staleTime: 30_000 });
}
