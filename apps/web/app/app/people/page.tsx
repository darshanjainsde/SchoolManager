'use client';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

interface UserRow {
  id: string;
  email: string;
  role: 'SCHOOL_ADMIN' | 'TEACHER' | 'STUDENT' | 'PARENT' | 'STAFF';
  firstName: string;
  lastName: string;
}

const ROLE_TONE: Record<UserRow['role'], 'info' | 'success' | 'neutral' | 'warning' | 'danger'> = {
  SCHOOL_ADMIN: 'danger',
  TEACHER: 'info',
  STUDENT: 'success',
  PARENT: 'warning',
  STAFF: 'neutral',
};

export default function PeoplePage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const [filter, setFilter] = useState('');
  const [role, setRole] = useState<UserRow['role'] | 'ALL'>('ALL');

  const users = useQuery({
    queryKey: ['users-page'],
    enabled: !!host,
    queryFn: () => api.get<UserRow[]>('/users'),
  });

  const rows = (users.data ?? []).filter((u) => {
    if (role !== 'ALL' && u.role !== role) return false;
    if (!filter) return true;
    const f = filter.toLowerCase();
    return (
      u.email.toLowerCase().includes(f) ||
      u.firstName.toLowerCase().includes(f) ||
      u.lastName.toLowerCase().includes(f)
    );
  });

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">People</h1>
        <p className="text-sm text-slate-500">All users in your school. Bulk import lives on the platform onboarding wizard for now.</p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>Users ({rows.length})</CardTitle>
          <CardDescription>Filter by role and name.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
            <Input placeholder="Search name or email…" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <Select value={role} onChange={(e) => setRole(e.target.value as UserRow['role'] | 'ALL')}>
              <option value="ALL">All roles</option>
              <option value="SCHOOL_ADMIN">Admins</option>
              <option value="TEACHER">Teachers</option>
              <option value="STUDENT">Students</option>
              <option value="PARENT">Parents</option>
              <option value="STAFF">Staff</option>
            </Select>
          </div>
          {users.isLoading ? (
            <div className="text-sm text-slate-500">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="text-sm text-slate-500">No users matched.</div>
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>Name</Th>
                  <Th>Email</Th>
                  <Th>Role</Th>
                </Tr>
              </THead>
              <TBody>
                {rows.map((u) => (
                  <Tr key={u.id}>
                    <Td className="font-medium text-slate-900">{u.firstName} {u.lastName}</Td>
                    <Td className="font-mono text-xs">{u.email}</Td>
                    <Td><Badge tone={ROLE_TONE[u.role]}>{u.role}</Badge></Td>
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
