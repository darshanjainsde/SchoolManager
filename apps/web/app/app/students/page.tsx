'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, Pencil, X } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';

// ── Types ────────────────────────────────────────────────────────────────────

interface SchoolClass {
  id: string;
  name: string;
  grade: { name: string };
}

interface Student {
  id: string;
  admissionNo: string;
  firstName: string;
  lastName: string;
  classSectionId: string | null;
  rollNo: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
  classSection: { name: string; grade: { name: string } } | null;
}

// ── Student Form (Add / Edit) ────────────────────────────────────────────────

interface StudentFormData {
  firstName: string;
  lastName: string;
  admissionNo: string;
  rollNo: string;
  classSectionId: string;
  guardianName: string;
  guardianPhone: string;
}

interface StudentFormProps {
  title: string;
  initial?: Partial<StudentFormData>;
  classes: SchoolClass[];
  onSave: (data: StudentFormData) => void;
  isSaving: boolean;
  onCancel: () => void;
}

function StudentForm({ title, initial = {}, classes, onSave, isSaving, onCancel }: StudentFormProps) {
  const [firstName, setFirstName] = useState(initial.firstName ?? '');
  const [lastName, setLastName] = useState(initial.lastName ?? '');
  const [admissionNo, setAdmissionNo] = useState(initial.admissionNo ?? '');
  const [rollNo, setRollNo] = useState(initial.rollNo ?? '');
  const [classSectionId, setClassSectionId] = useState(initial.classSectionId ?? '');
  const [guardianName, setGuardianName] = useState(initial.guardianName ?? '');
  const [guardianPhone, setGuardianPhone] = useState(initial.guardianPhone ?? '');

  const canSave = firstName.trim() && lastName.trim() && admissionNo.trim();

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="sf-first">First name</Label>
            <Input
              id="sf-first"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="Jane"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sf-last">Last name</Label>
            <Input
              id="sf-last"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Doe"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="sf-admission">Admission no.</Label>
            <Input
              id="sf-admission"
              value={admissionNo}
              onChange={(e) => setAdmissionNo(e.target.value)}
              placeholder="ADM-001"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sf-roll">Roll no. (optional)</Label>
            <Input
              id="sf-roll"
              value={rollNo}
              onChange={(e) => setRollNo(e.target.value)}
              placeholder="1"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="sf-class">Class (optional)</Label>
          <Select
            id="sf-class"
            value={classSectionId}
            onChange={(e) => setClassSectionId(e.target.value)}
          >
            <option value="">— Unassigned —</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.grade.name} — {c.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="sf-guardian-name">Guardian name (optional)</Label>
            <Input
              id="sf-guardian-name"
              value={guardianName}
              onChange={(e) => setGuardianName(e.target.value)}
              placeholder="John Doe"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sf-guardian-phone">Guardian phone (optional)</Label>
            <Input
              id="sf-guardian-phone"
              value={guardianPhone}
              onChange={(e) => setGuardianPhone(e.target.value)}
              placeholder="+1 555 0100"
            />
          </div>
        </div>
      </CardContent>
      <CardFooter className="gap-2">
        <Button
          onClick={() =>
            onSave({
              firstName: firstName.trim(),
              lastName: lastName.trim(),
              admissionNo: admissionNo.trim(),
              rollNo: rollNo.trim(),
              classSectionId,
              guardianName: guardianName.trim(),
              guardianPhone: guardianPhone.trim(),
            })
          }
          disabled={isSaving || !canSave}
        >
          {isSaving ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </CardFooter>
    </Card>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function classBadgeLabel(student: Student): string | null {
  if (!student.classSection) return null;
  return `${student.classSection.grade.name} — ${student.classSection.name}`;
}

function apiErrorMessage(err: Error): string {
  return err.message;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function StudentsPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const queryClient = useQueryClient();

  // ── Local state ──────────────────────────────────────────────────────────
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [classFilter, setClassFilter] = useState('');

  // ── Queries ──────────────────────────────────────────────────────────────
  const classesQuery = useQuery({
    queryKey: ['mng-classes'],
    queryFn: () => api.get<SchoolClass[]>('/manage/classes'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const studentsQuery = useQuery({
    queryKey: ['mng-students', classFilter],
    queryFn: () => {
      const qs = classFilter ? `?classSectionId=${encodeURIComponent(classFilter)}` : '';
      return api.get<Student[]>(`/manage/students${qs}`);
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  // ── Mutations ─────────────────────────────────────────────────────────────
  const addMutation = useMutation({
    mutationFn: (data: StudentFormData) => {
      const body: Record<string, string | undefined> = {
        firstName: data.firstName,
        lastName: data.lastName,
        admissionNo: data.admissionNo,
        rollNo: data.rollNo || undefined,
        classSectionId: data.classSectionId || undefined,
        guardianName: data.guardianName || undefined,
        guardianPhone: data.guardianPhone || undefined,
      };
      return api.post<Student>('/manage/students', body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mng-students'] });
      setShowAdd(false);
      toast.success('Student added');
    },
    onError: (err: Error) => {
      const msg = apiErrorMessage(err);
      if (msg.includes('409') || msg.toLowerCase().includes('duplicate') || msg.toLowerCase().includes('already')) {
        toast.error(`Duplicate admission no.: ${msg}`);
      } else if (msg.includes('400') || msg.toLowerCase().includes('class')) {
        toast.error(`Invalid class: ${msg}`);
      } else {
        toast.error(`Failed to add student: ${msg}`);
      }
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: StudentFormData }) => {
      const body: Record<string, string | undefined> = {
        firstName: data.firstName,
        lastName: data.lastName,
        admissionNo: data.admissionNo,
        rollNo: data.rollNo || undefined,
        classSectionId: data.classSectionId || undefined,
        guardianName: data.guardianName || undefined,
        guardianPhone: data.guardianPhone || undefined,
      };
      return api.put<Student>(`/manage/students/${id}`, body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mng-students'] });
      setEditId(null);
      toast.success('Student updated');
    },
    onError: (err: Error) => {
      const msg = apiErrorMessage(err);
      if (msg.includes('409') || msg.toLowerCase().includes('duplicate') || msg.toLowerCase().includes('already')) {
        toast.error(`Duplicate admission no.: ${msg}`);
      } else if (msg.includes('400') || msg.toLowerCase().includes('class')) {
        toast.error(`Invalid class: ${msg}`);
      } else {
        toast.error(`Failed to update student: ${msg}`);
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/manage/students/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mng-students'] });
      toast.success('Student removed');
    },
    onError: (err: Error) => toast.error(`Failed to delete student: ${err.message}`),
  });

  // Derive the initial values for the edit form from current student data
  const editingStudent = editId ? (studentsQuery.data ?? []).find((s) => s.id === editId) : null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Students</h1>
          <p className="mt-1 text-sm text-slate-500">Manage enrolled students.</p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            setShowAdd((v) => !v);
            setEditId(null);
          }}
        >
          {showAdd ? (
            <>
              <X className="h-4 w-4 mr-1" /> Cancel
            </>
          ) : (
            <>
              <Plus className="h-4 w-4 mr-1" /> Add student
            </>
          )}
        </Button>
      </header>

      {/* Add form */}
      {showAdd && (
        <StudentForm
          title="Add student"
          classes={classesQuery.data ?? []}
          onSave={(data) => addMutation.mutate(data)}
          isSaving={addMutation.isPending}
          onCancel={() => setShowAdd(false)}
        />
      )}

      {/* Edit form */}
      {editId && editingStudent && (
        <StudentForm
          title="Edit student"
          initial={{
            firstName: editingStudent.firstName,
            lastName: editingStudent.lastName,
            admissionNo: editingStudent.admissionNo,
            rollNo: editingStudent.rollNo ?? '',
            classSectionId: editingStudent.classSectionId ?? '',
            guardianName: editingStudent.guardianName ?? '',
            guardianPhone: editingStudent.guardianPhone ?? '',
          }}
          classes={classesQuery.data ?? []}
          onSave={(data) => updateMutation.mutate({ id: editId, data })}
          isSaving={updateMutation.isPending}
          onCancel={() => setEditId(null)}
        />
      )}

      {/* Class filter */}
      <div className="flex items-center gap-3">
        <Label htmlFor="class-filter" className="shrink-0 text-sm font-medium text-slate-700">
          Filter by class:
        </Label>
        <Select
          id="class-filter"
          value={classFilter}
          onChange={(e) => setClassFilter(e.target.value)}
          className="max-w-xs"
        >
          <option value="">All classes</option>
          {(classesQuery.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.grade.name} — {c.name}
            </option>
          ))}
        </Select>
      </div>

      {/* Loading / error */}
      {studentsQuery.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      {studentsQuery.error && (
        <p className="text-sm text-rose-600">{(studentsQuery.error as Error).message}</p>
      )}

      {/* Empty state */}
      {!studentsQuery.isLoading && (studentsQuery.data?.length ?? 0) === 0 && (
        <p className="text-sm text-slate-400">No students found. Add one above.</p>
      )}

      {/* Students table */}
      {(studentsQuery.data?.length ?? 0) > 0 && (
        <Table>
          <THead>
            <Tr>
              <Th>Roll no.</Th>
              <Th>Name</Th>
              <Th>Admission no.</Th>
              <Th>Class</Th>
              <Th>Guardian</Th>
              <Th>Contact</Th>
              <Th />
            </Tr>
          </THead>
          <TBody>
            {studentsQuery.data!.map((student) => (
              <Tr key={student.id}>
                <Td className="text-slate-500">{student.rollNo ?? '—'}</Td>
                <Td className="font-medium text-slate-900">
                  {student.firstName} {student.lastName}
                </Td>
                <Td className="text-slate-500">{student.admissionNo}</Td>
                <Td>
                  {classBadgeLabel(student) ? (
                    <Badge tone="info">{classBadgeLabel(student)}</Badge>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </Td>
                <Td>{student.guardianName ?? <span className="text-slate-400">—</span>}</Td>
                <Td>{student.guardianPhone ?? <span className="text-slate-400">—</span>}</Td>
                <Td>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setShowAdd(false);
                        setEditId(student.id);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5 mr-1" />
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={deleteMutation.isPending}
                      onClick={() => deleteMutation.mutate(student.id)}
                      className="text-rose-500 hover:bg-rose-50 hover:text-rose-700"
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1" />
                      Delete
                    </Button>
                  </div>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
