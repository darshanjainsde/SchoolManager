import { fireEvent, render } from '@testing-library/react-native';
import ReportCards from '../(tabs)/home/report-cards';
import ReportCard from '../(tabs)/home/report-cards/[id]';
import { api } from '@/lib/api';
import { clearCache } from '@/lib/query';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...a: unknown[]) => mockPush(...a) },
  useLocalSearchParams: () => ({ id: 'rc-1' }),
  useFocusEffect: (effect: () => void) => {
    const React = jest.requireActual('react');
    React.useEffect(effect, []);
  },
}));
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { ...actual.api, request: jest.fn() } };
});

beforeEach(() => {
  clearCache();
  (api.request as jest.Mock).mockReset();
  mockPush.mockReset();
});

describe('Report cards', () => {
  it('lists the issued cards and opens one', async () => {
    (api.request as jest.Mock).mockResolvedValue([{ id: 'rc-1', serial: 'RC/2026/0042', windowName: 'Term 1', academicYearName: '2026–27', issuedAt: '2026-07-28T00:00:00Z' }]);
    const { findByTestId, getByText } = render(<ReportCards />);
    fireEvent.press(await findByTestId('report-card-rc-1'));
    expect(getByText('Term 1 · 2026–27')).toBeTruthy();
    expect(mockPush).toHaveBeenCalledWith('/(family)/(tabs)/home/report-cards/rc-1');
  });

  it('renders the card as issued — subjects in mono, the remark in the diary italic', async () => {
    (api.request as jest.Mock).mockResolvedValue({
      id: 'rc-1', serial: 'RC/2026/0042', issuedAt: '2026-07-28T00:00:00Z',
      snapshot: {
        kind: 'REPORT_CARD',
        school: { name: 'Saraswati Public School', logoUrl: null, addressLine: '12 MG Road, Jaipur', phone: null, email: null },
        windowName: 'Term 1', academicYearName: '2026–27', classLabel: '7-B', classTeacherName: 'Mrs Iyer',
        student: { name: 'Saanvi Krishnamurthy', rollNo: '14', admissionNo: 'A1', dob: null, guardianName: null },
        subjects: [
          { subjectId: 'm', subjectName: 'Mathematics', examCount: 2, marks: 86, maxMarks: 100, pct: 86, grade: 'A2' },
          { subjectId: 'h', subjectName: 'Hindi', examCount: 1, marks: null, maxMarks: 50, pct: null, grade: null },
        ],
        overall: { marks: 86, maxMarks: 100, pct: 86, grade: 'A2' },
        attendance: { present: 58, total: 62, pct: 93.5 },
        remark: 'Reads widely. Should speak up more in class.',
      },
    });
    const { findByTestId, getByText } = render(<ReportCard />);
    expect(await findByTestId('report-card')).toBeTruthy();
    expect(getByText('Saraswati Public School')).toBeTruthy();
    expect(getByText('86/100')).toBeTruthy();
    expect(getByText('A2')).toBeTruthy();
    expect(getByText('Reads widely. Should speak up more in class.')).toBeTruthy();
    expect(getByText(/RC\/2026\/0042/)).toBeTruthy();
  });
});
