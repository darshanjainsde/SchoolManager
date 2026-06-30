'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

interface Me { userId: string }
interface Invoice {
  id: string; number: number; amountDue: number; amountPaid: number; currency: string;
  status: 'OPEN' | 'PARTIAL' | 'PAID' | 'VOID' | 'REFUNDED'; dueDate: string;
}

export default function MyInvoicesPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const [me, setMe] = useState<Me | undefined>();
  useEffect(() => { if (host) api.get<Me>('/auth/me').then(setMe).catch(() => undefined); }, [host, api]);

  const list = useQuery({
    queryKey: ['my-invoices', me?.userId],
    enabled: !!me,
    queryFn: () => api.get<Invoice[]>(`/invoices?studentUserId=${me!.userId}`),
  });

  const checkout = useMutation({
    mutationFn: (id: string) => api.post<{ sessionUrl: string }>(`/invoices/${id}/checkout`),
    onSuccess: ({ sessionUrl }) => {
      if (sessionUrl) window.location.href = sessionUrl;
      else toast.error('No checkout URL returned');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const tone = (s: Invoice['status']) =>
    s === 'PAID' ? 'success' : s === 'OPEN' || s === 'PARTIAL' ? 'warning' : s === 'VOID' || s === 'REFUNDED' ? 'neutral' : 'danger';

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Invoices</h1>
        <p className="text-sm text-slate-500">Pay with card via Stripe Checkout, or pay in person and the office records it.</p>
      </header>
      <Card>
        <CardHeader><CardTitle>My invoices</CardTitle><CardDescription>{list.data?.length ?? 0}</CardDescription></CardHeader>
        <CardContent>
          {!list.data?.length ? <div className="text-sm text-slate-500">No invoices.</div> : (
            <Table>
              <THead><Tr><Th>#</Th><Th>Amount</Th><Th>Status</Th><Th>Due</Th><Th className="text-right">Actions</Th></Tr></THead>
              <TBody>
                {list.data.map((i) => (
                  <Tr key={i.id}>
                    <Td className="font-mono">{i.number}</Td>
                    <Td>{i.currency} {Number(i.amountDue).toFixed(2)}</Td>
                    <Td><Badge tone={tone(i.status)}>{i.status}</Badge></Td>
                    <Td>{new Date(i.dueDate).toLocaleDateString()}</Td>
                    <Td className="text-right">
                      {i.status !== 'PAID' && i.status !== 'VOID' && (
                        <Button size="sm" onClick={() => checkout.mutate(i.id)} disabled={checkout.isPending}>
                          Pay
                        </Button>
                      )}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
