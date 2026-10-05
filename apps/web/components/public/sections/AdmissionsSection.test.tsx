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

/**
 * A STEP IS A HEADING AND ITS DETAILS, WRITTEN THE WAY THE SCHOOL TYPED THEM.
 *
 * The body used to be one `<p>`: a school that typed the documents to bring
 * on separate lines got them run together into one sentence. It now goes
 * through the same page-text grammar as the page builder, on both layouts.
 */
describe('a step body keeps its lines and lists', () => {
  const steps = [
    {
      title: 'Submit the form',
      description: 'Bring these on the day:\n- Birth certificate\n- Two passport photos\n\n1. Fill the form\n2. Pay the fee',
    },
  ];

  for (const variant of ['journey', 'rail'] as const) {
    it(`renders bullets and numbers as real lists (${variant})`, () => {
      const { container } = render(
        <AdmissionsSection admissions={admissions({ steps } as never)} courses={[]} variant={variant} />,
      );
      expect(screen.getByRole('heading', { name: 'Submit the form' })).toBeInTheDocument();
      expect(screen.getByText('Bring these on the day:')).toBeInTheDocument();
      const ul = container.querySelector('.ps-step-body ul');
      const ol = container.querySelector('.ps-step-body ol');
      expect([...ul!.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
        'Birth certificate',
        'Two passport photos',
      ]);
      expect([...ol!.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['Fill the form', 'Pay the fee']);
    });
  }

  it('never interprets the body as HTML', () => {
    const { container } = render(
      <AdmissionsSection
        admissions={admissions({ steps: [{ title: 'Visit', description: '<img src=x onerror=alert(1)>' }] } as never)}
        courses={[]}
      />,
    );
    expect(container.querySelector('.ps-step-body img')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
  });
});
