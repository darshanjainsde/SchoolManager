import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import StudentsPage from './page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));

interface StudentRow {
  id: string;
  admissionNo: string;
  firstName: string;
  lastName: string;
  email: string | null;
  classSectionId: string | null;
  rollNo: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
  photoAssetId: string | null;
  classSection: { name: string; grade: { name: string } } | null;
  userId: string | null;
}

function student(overrides: Partial<StudentRow>): StudentRow {
  return {
    id: 's-1',
    admissionNo: 'ADM-001',
    firstName: 'Rahul',
    lastName: 'Verma',
    email: null,
    classSectionId: null,
    rollNo: null,
    guardianName: null,
    guardianPhone: null,
    photoAssetId: null,
    classSection: null,
    userId: null,
    ...overrides,
  };
}

function mockApi(overrides: Partial<ApiStub> = {}): ApiStub {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), ...overrides };
}

beforeEach(() => {
  vi.mocked(useHost).mockReturnValue('school.sckools.com');
});

describe('StudentsPage avatars', () => {
  it('renders a photo for a student whose photoAssetId resolves via /site/media?kind=AVATAR, and initials otherwise', async () => {
    const get = vi.fn((path: string) => {
      if (path.startsWith('/manage/classes')) return Promise.resolve([]);
      if (path.startsWith('/manage/students')) {
        return Promise.resolve([
          student({ id: 's-1', admissionNo: 'ADM-001', firstName: 'Rahul', lastName: 'Verma', photoAssetId: 'asset-1' }),
          student({ id: 's-2', admissionNo: 'ADM-002', firstName: 'Meera', lastName: 'Shah', photoAssetId: null }),
        ]);
      }
      if (path.startsWith('/site/media')) {
        return Promise.resolve([{ id: 'asset-1', url: 'https://cdn.example.com/rahul.jpg' }]);
      }
      return Promise.resolve([]);
    });
    vi.mocked(useApi).mockReturnValue(mockApi({ get: get as ApiStub['get'] }) as never);

    renderWithProviders(<StudentsPage />);

    // Self-uploaded avatars are kind AVATAR — the map must come from that list.
    const img = await screen.findByAltText('Rahul Verma');
    expect(img).toHaveAttribute('src', 'https://cdn.example.com/rahul.jpg');
    expect(get).toHaveBeenCalledWith('/site/media?kind=AVATAR');

    // No photoAssetId → initials fallback, never a broken <img>.
    expect(screen.getByText('MS')).toBeInTheDocument();
    expect(screen.queryByAltText('Meera Shah')).not.toBeInTheDocument();
  });

  it('falls back to initials (not a broken image) when the asset list has no entry for the id', async () => {
    const get = vi.fn((path: string) => {
      if (path.startsWith('/manage/students')) {
        return Promise.resolve([
          student({ id: 's-1', firstName: 'Rahul', lastName: 'Verma', photoAssetId: 'asset-gone' }),
        ]);
      }
      return Promise.resolve([]);
    });
    vi.mocked(useApi).mockReturnValue(mockApi({ get: get as ApiStub['get'] }) as never);

    renderWithProviders(<StudentsPage />);

    expect(await screen.findByText('Rahul Verma')).toBeInTheDocument();
    expect(screen.getByText('RV')).toBeInTheDocument();
    expect(screen.queryByAltText('Rahul Verma')).not.toBeInTheDocument();
  });
});
