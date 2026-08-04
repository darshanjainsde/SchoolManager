import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AdmissionsSection from './AdmissionsSection';
import type { PublicCourse, PublicSiteData } from '@/lib/public-api';

/**
 * FEES BELONG ON /admissions AND NOWHERE ELSE.
 *
 * This section renders twice — a band on the home page and the whole of the
 * admissions page — and the fee table came with it in both. A school that
 * filled in its fees found them published halfway down its front page.
 *
 * Fees are the figures a family screenshots and a competitor reads, and an
 * admissions office wants them read in context: under the process, next to the
 * note saying what the number includes. The home page has none of that.
 */

const COURSES: PublicCourse[] = [
  {
    id: 'c1',
    name: 'Class 1',
    fee: { admissionFee: '₹25,000', annualFee: '₹1,20,000', includes: 'Books, uniform' },
  } as PublicCourse,
];

function admissions(over: Partial<PublicSiteData['admissions']> = {}): PublicSiteData['admissions'] {
  return {
    steps: [{ title: 'Enquire', body: 'Send us a note.' }],
    showFees: true,
    feeNote: 'Fees are reviewed annually.',
    ...over,
  } as PublicSiteData['admissions'];
}

describe('where the fee table is allowed to appear', () => {
  it('does NOT render fees by default — the home page never asks for them', () => {
    render(<AdmissionsSection admissions={admissions()} courses={COURSES} />);
    expect(screen.queryByText(/fee structure/i)).not.toBeInTheDocument();
    expect(screen.queryByText('₹1,20,000')).not.toBeInTheDocument();
    // The admissions process itself still shows — only the money is withheld.
    expect(screen.getByText('Enquire')).toBeInTheDocument();
  });

  it('renders fees when the admissions page explicitly asks', () => {
    render(<AdmissionsSection admissions={admissions()} courses={COURSES} showFeeTable />);
    expect(screen.getByText(/fee structure/i)).toBeInTheDocument();
    expect(screen.getByText('₹1,20,000')).toBeInTheDocument();
  });

  it('still respects a school that switched fees off entirely', () => {
    // `showFeeTable` decides WHERE fees may appear; `showFees` is the school's
    // own decision about whether they are published at all. Overriding that
    // would put a school's fees online after it chose to hide them.
    render(<AdmissionsSection admissions={admissions({ showFees: false })} courses={COURSES} showFeeTable />);
    expect(screen.queryByText(/fee structure/i)).not.toBeInTheDocument();
  });

  it('renders nothing at all when fees were the only content and they are withheld', () => {
    // Otherwise a school whose admissions content is fees-only gets an empty
    // headed band on its front page — a worse bug than the one being fixed.
    const { container } = render(
      <AdmissionsSection admissions={admissions({ steps: [] })} courses={COURSES} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('still renders that fees-only school its fee table on the admissions page', () => {
    render(<AdmissionsSection admissions={admissions({ steps: [] })} courses={COURSES} showFeeTable />);
    expect(screen.getByText(/fee structure/i)).toBeInTheDocument();
  });
});
