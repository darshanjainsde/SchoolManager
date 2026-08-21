'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import ImageUploader from './image-uploader';
import type { MediaAsset, StaffMember } from './types';

/**
 * Staff tab — self-contained: staff rows plus the STAFF media list used to
 * resolve photo URLs. Mounting is the gate that `enabled: activeTab ===
 * 'staff'` used to be.
 */
export default function StaffTab() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const queryClient = useQueryClient();

  const staffQuery = useQuery({
    queryKey: ['site-staff'],
    queryFn: () => api.get<StaffMember[]>('/site/staff'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!host,
  });

  // Staff media query — used to resolve photo URLs from photoAssetId
  const staffMediaQuery = useQuery({
    queryKey: ['site-media-staff'],
    queryFn: () => api.get<MediaAsset[]>('/site/media?kind=STAFF'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!host,
  });

  const [showAddStaff, setShowAddStaff] = useState(false);
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffRole, setNewStaffRole] = useState('');
  const [newStaffPhotoAssetId, setNewStaffPhotoAssetId] = useState<string | null>(null);
  const [newStaffPhotoPreviewUrl, setNewStaffPhotoPreviewUrl] = useState<string | null>(null);
  const [isUploadingNewStaffPhoto, setIsUploadingNewStaffPhoto] = useState(false);
  // Edit state
  const [editingStaffId, setEditingStaffId] = useState<string | null>(null);
  const [editStaffName, setEditStaffName] = useState('');
  const [editStaffRole, setEditStaffRole] = useState('');
  const [editStaffPhotoAssetId, setEditStaffPhotoAssetId] = useState<string | null>(null);
  const [editStaffPhotoPreviewUrl, setEditStaffPhotoPreviewUrl] = useState<string | null>(null);
  const [isUploadingEditStaffPhoto, setIsUploadingEditStaffPhoto] = useState(false);

  const addStaffMutation = useMutation({
    mutationFn: (member: { name: string; role: string; photoAssetId?: string | null; order: number }) =>
      api.post<StaffMember>('/site/staff', member),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['site-staff'] });
      setShowAddStaff(false);
      setNewStaffName('');
      setNewStaffRole('');
      setNewStaffPhotoAssetId(null);
      setNewStaffPhotoPreviewUrl(null);
      toast.success('Staff member added');
    },
    onError: (err: Error) => toast.error(`Failed to add staff: ${err.message}`),
  });

  const updateStaffMutation = useMutation({
    mutationFn: ({ id, ...data }: { id: string; name: string; role: string; photoAssetId?: string | null; order: number }) =>
      api.put<StaffMember>(`/site/staff/${id}`, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['site-staff'] });
      setEditingStaffId(null);
      toast.success('Staff member updated');
    },
    onError: (err: Error) => toast.error(`Failed to update staff: ${err.message}`),
  });

  const deleteStaffMutation = useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/site/staff/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['site-staff'] });
      toast.success('Staff member deleted');
    },
    onError: (err: Error) => toast.error(`Failed to delete staff: ${err.message}`),
  });

  async function uploadNewStaffPhoto(file: File) {
    setIsUploadingNewStaffPhoto(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const asset = await api.request<MediaAsset>('/site/media?kind=STAFF', {
        method: 'POST',
        body: fd,
      });
      setNewStaffPhotoAssetId(asset.id);
      setNewStaffPhotoPreviewUrl(asset.url);
      void queryClient.invalidateQueries({ queryKey: ['site-media-staff'] });
      toast.success('Photo uploaded');
    } catch (err) {
      toast.error(`Photo upload failed: ${(err as Error).message}`);
    } finally {
      setIsUploadingNewStaffPhoto(false);
    }
  }

  async function uploadEditStaffPhoto(file: File) {
    setIsUploadingEditStaffPhoto(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const asset = await api.request<MediaAsset>('/site/media?kind=STAFF', {
        method: 'POST',
        body: fd,
      });
      setEditStaffPhotoAssetId(asset.id);
      setEditStaffPhotoPreviewUrl(asset.url);
      void queryClient.invalidateQueries({ queryKey: ['site-media-staff'] });
      toast.success('Photo uploaded');
    } catch (err) {
      toast.error(`Photo upload failed: ${(err as Error).message}`);
    } finally {
      setIsUploadingEditStaffPhoto(false);
    }
  }

  // Build a lookup map: photoAssetId → url from the staff media list
  const staffPhotoUrlMap: Record<string, string> = {};
  for (const asset of staffMediaQuery.data ?? []) {
    staffPhotoUrlMap[asset.id] = asset.url;
  }
  return (
    <div className="space-y-6 w-full">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Featured staff</h2>
          <p className="text-sm text-slate-500">
            Manage staff members displayed on your school website.
          </p>
        </div>
        <Button onClick={() => { setShowAddStaff((v) => !v); setEditingStaffId(null); }} variant="outline">
          <Plus className="h-4 w-4 mr-1" />
          {showAddStaff ? 'Cancel' : 'Add staff'}
        </Button>
      </div>

      {/* Add staff form */}
      {showAddStaff && (
        <Card>
          <CardHeader>
            <CardTitle>Add staff member</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-staff-name">Name</Label>
              <Input
                id="new-staff-name"
                value={newStaffName}
                onChange={(e) => setNewStaffName(e.target.value)}
                placeholder="Dr. Jane Smith"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-staff-role">Role / Title</Label>
              <Input
                id="new-staff-role"
                value={newStaffRole}
                onChange={(e) => setNewStaffRole(e.target.value)}
                placeholder="Principal"
              />
            </div>
            <ImageUploader
              label="Photo (optional)"
              hint="Portrait photo. Max 8 MB."
              previewUrl={newStaffPhotoPreviewUrl}
              isUploading={isUploadingNewStaffPhoto}
              onFile={uploadNewStaffPhoto}
            />
          </CardContent>
          <CardFooter className="gap-2">
            <Button
              onClick={() =>
                addStaffMutation.mutate({
                  name: newStaffName,
                  role: newStaffRole,
                  photoAssetId: newStaffPhotoAssetId,
                  order: staffQuery.data?.length ?? 0,
                })
              }
              disabled={addStaffMutation.isPending || !newStaffName.trim() || !newStaffRole.trim()}
            >
              {addStaffMutation.isPending ? 'Adding…' : 'Add member'}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setShowAddStaff(false);
                setNewStaffName('');
                setNewStaffRole('');
                setNewStaffPhotoAssetId(null);
                setNewStaffPhotoPreviewUrl(null);
              }}
            >
              Cancel
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* Staff list */}
      {staffQuery.isLoading && (
        <p className="text-sm text-slate-500">Loading staff…</p>
      )}
      {staffQuery.error && (
        <p className="text-sm text-rose-600">{(staffQuery.error as Error).message}</p>
      )}
      {staffQuery.data && staffQuery.data.length === 0 && !showAddStaff && (
        <p className="text-sm text-slate-400">
          No staff members yet. Click &quot;Add staff&quot; above.
        </p>
      )}
      {staffQuery.data && staffQuery.data.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {staffQuery.data.map((member) =>
            editingStaffId === member.id ? (
              /* Edit mode card */
              <Card key={member.id}>
                <CardHeader>
                  <CardTitle className="text-base">Edit staff member</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Name</Label>
                    <Input
                      value={editStaffName}
                      onChange={(e) => setEditStaffName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Role / Title</Label>
                    <Input
                      value={editStaffRole}
                      onChange={(e) => setEditStaffRole(e.target.value)}
                    />
                  </div>
                  <ImageUploader
                    label="Photo (optional)"
                    hint="Upload a new photo to replace the current one."
                    previewUrl={editStaffPhotoPreviewUrl}
                    hasExistingAsset={!!editStaffPhotoAssetId && !editStaffPhotoPreviewUrl}
                    isUploading={isUploadingEditStaffPhoto}
                    onFile={uploadEditStaffPhoto}
                  />
                </CardContent>
                <CardFooter className="gap-2">
                  <Button
                    onClick={() =>
                      updateStaffMutation.mutate({
                        id: member.id,
                        name: editStaffName,
                        role: editStaffRole,
                        photoAssetId: editStaffPhotoAssetId,
                        order: member.order,
                      })
                    }
                    disabled={
                      updateStaffMutation.isPending ||
                      !editStaffName.trim() ||
                      !editStaffRole.trim()
                    }
                  >
                    {updateStaffMutation.isPending ? 'Saving…' : 'Save'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setEditingStaffId(null);
                      setEditStaffPhotoPreviewUrl(null);
                    }}
                  >
                    Cancel
                  </Button>
                </CardFooter>
              </Card>
            ) : (
              /* View mode card */
              <Card key={member.id}>
                <CardContent className="flex items-start gap-4 pt-4">
                  {member.photoAssetId && staffPhotoUrlMap[member.photoAssetId] ? (
                    <img
                      src={staffPhotoUrlMap[member.photoAssetId]}
                      alt={member.name}
                      className="h-16 w-16 rounded-full object-cover border border-slate-200 shrink-0"
                    />
                  ) : (
                    <div className="h-16 w-16 rounded-full bg-slate-200 flex items-center justify-center shrink-0 text-slate-600 text-xl font-semibold select-none">
                      {member.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-800 truncate">{member.name}</p>
                    <p className="text-sm text-slate-500 truncate">{member.role}</p>
                    {member.photoAssetId && !staffPhotoUrlMap[member.photoAssetId] && (
                      <p className="text-xs text-slate-400 italic mt-1">Photo set</p>
                    )}
                  </div>
                </CardContent>
                <CardFooter className="gap-2 pt-0">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setShowAddStaff(false);
                      setEditingStaffId(member.id);
                      setEditStaffName(member.name);
                      setEditStaffRole(member.role);
                      setEditStaffPhotoAssetId(member.photoAssetId ?? null);
                      setEditStaffPhotoPreviewUrl(null);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={deleteStaffMutation.isPending}
                    onClick={() => deleteStaffMutation.mutate(member.id)}
                    className="text-rose-500 hover:bg-rose-50 hover:text-rose-700"
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    Delete
                  </Button>
                </CardFooter>
              </Card>
            )
          )}
        </div>
      )}
    </div>
  );
}
