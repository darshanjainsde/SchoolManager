import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { OrderDrawer } from './order-drawer';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));
const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

function mockApi(overrides: Partial<ApiStub & { postForm: ReturnType<typeof vi.fn> }> = {}) {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), postForm: vi.fn(), ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  (useHost as ReturnType<typeof vi.fn>).mockReturnValue('raffles.test');
});

describe('OrderDrawer — report-card batches', () => {
  it('posts the REAL order endpoint with numbers as numbers, then lands on the order page', async () => {
    const api = mockApi({ post: vi.fn().mockResolvedValue({ id: 'ord-1' }) });
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(api);

    renderWithProviders(
      <OrderDrawer
        target={{ kind: 'REPORT_CARDS', windowId: 'w1', classSectionId: 'c1', issuedCount: 42, batchLabel: 'VII-B · Term I' }}
        onClose={vi.fn()}
      />,
    );

    // The batch facts are on the drawer — the office confirms what it is ordering.
    expect(screen.getByText(/42 issued card/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Request a quote' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/manage/press/orders/report-cards', {
      windowId: 'w1', classSectionId: 'c1',
      // JSON body: real numbers, and the card-stock default for report cards.
      quantity: 1, size: 'A4', colour: 'COLOUR', sides: 'DOUBLE', gsm: 170, finish: 'NONE',
    }));
    expect(push).toHaveBeenCalledWith('/app/press/orders/ord-1');
  });
});

describe('OrderDrawer — uploads', () => {
  it('refuses a non-PDF before anything leaves the browser', async () => {
    const api = mockApi();
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(api);

    renderWithProviders(<OrderDrawer target={{ kind: 'UPLOAD' }} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/What is it/), { target: { value: 'Term I Maths paper' } });
    const file = new File(['x'], 'paper.docx', { type: 'application/msword' });
    fireEvent.change(screen.getByLabelText(/The PDF/), { target: { files: [file] } });

    expect(await screen.findByText(/Only PDFs print faithfully/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Request a quote' })).toBeDisabled();
    expect(api.postForm).not.toHaveBeenCalled();
  });

  it('sends a PDF as multipart to the real upload endpoint', async () => {
    const api = mockApi({ postForm: vi.fn().mockResolvedValue({ id: 'ord-2' }) });
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(api);

    renderWithProviders(<OrderDrawer target={{ kind: 'UPLOAD' }} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/What is it/), { target: { value: 'Term I Maths paper' } });
    const file = new File(['%PDF-1.4'], 'paper.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText(/The PDF/), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Request a quote' }));

    await waitFor(() => expect(api.postForm).toHaveBeenCalledTimes(1));
    const [path, form] = api.postForm.mock.calls[0] as [string, FormData];
    expect(path).toBe('/manage/press/orders/upload');
    expect((form.get('file') as File).name).toBe('paper.pdf');
    expect(form.get('title')).toBe('Term I Maths paper');
    expect(form.get('gsm')).toBe('80'); // everyday paper is the upload default
    expect(push).toHaveBeenCalledWith('/app/press/orders/ord-2');
  });
});
