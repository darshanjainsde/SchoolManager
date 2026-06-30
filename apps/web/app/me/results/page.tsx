'use client';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

interface Exam {
  id: string; name: string;
  examResults: Array<{ id: string; studentUserId: string; status: string; reportCards?: Array<{ pdfUrl: string }> }>;
  class: { name: string; grade: { name: string } };
}
interface Me { userId: string }

export default function MyResultsPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const [me, setMe] = useState<Me | undefined>();
  useEffect(() => { if (host) api.get<Me>('/auth/me').then(setMe).catch(() => undefined); }, [host, api]);

  const exams = useQuery({
    queryKey: ['my-exams'],
    enabled: !!me,
    queryFn: () => api.get<Exam[]>('/exams'),
  });

  const myPublished = (exams.data ?? [])
    .map((e) => ({
      exam: e,
      mine: e.examResults.find((r) => r.studentUserId === me?.userId && r.status === 'PUBLISHED'),
    }))
    .filter((x) => x.mine);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Results</h1>
        <p className="text-sm text-slate-500">Only published results are visible.</p>
      </header>
      <Card>
        <CardHeader><CardTitle>Published exams</CardTitle><CardDescription>{myPublished.length}</CardDescription></CardHeader>
        <CardContent>
          {myPublished.length === 0 ? <div className="text-sm text-slate-500">Nothing published yet.</div> : (
            <Table>
              <THead><Tr><Th>Exam</Th><Th>Class</Th><Th>Report card</Th></Tr></THead>
              <TBody>
                {myPublished.map(({ exam, mine }) => (
                  <Tr key={exam.id}>
                    <Td className="font-medium">{exam.name}</Td>
                    <Td>{exam.class.grade.name} · {exam.class.name}</Td>
                    <Td>
                      {mine?.reportCards?.[0]?.pdfUrl ? (
                        <a className="text-blue-600 underline" href={mine.reportCards[0].pdfUrl} target="_blank" rel="noreferrer">
                          PDF
                        </a>
                      ) : (
                        <span className="text-slate-400">Generating…</span>
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
