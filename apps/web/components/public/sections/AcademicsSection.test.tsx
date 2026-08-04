import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AcademicsSection from './AcademicsSection';
import type { PublicCourse } from '@/lib/public-api';

/**
 * A SECTION MUST NOT INTRODUCE ITSELF TWICE.
 *
 * AcademicsSection carries its own eyebrow ("Academics") and heading
 * ("Programmes for every stage"), which is right on the home page where it has
 * to announce itself between other bands. On /academics it was wrong twice
 * over: PublicSite already renders a page masthead, so "ACADEMICS" appeared
 * twice and two headings competed — one left-aligned, one centred, saying
 * nearly the same thing.
 *
 * Same bug class as the fee table: a section that does not know which context
 * it is in. Default stays "band on the home page", so the standalone caller has
 * to say so — a new caller cannot inherit the duplicate by accident.
 */

// Built from the full PublicCourse shape, not an `as PublicCourse` cast.
// The cast is what let a fixture missing `highlights` compile and then crash on
// `.length` at render — the type was right there and the assertion silenced it.
function course(over: Partial<PublicCourse> & { id: string; name: string }): PublicCourse {
  return {
    tagline: null,
    description: 'A gentle first step.',
    highlights: [],
    ageRange: null,
    imageUrl: null,
    featured: false,
    fee: null,
    hallOfFame: [],
    ...over,
  };
}

const COURSES: PublicCourse[] = [
  course({ id: 'c1', name: 'Preschool (Nursery–UKG)', ageRange: '3–5 yrs' }),
  course({ id: 'c2', name: 'Primary (I–V)', ageRange: '6–10 yrs' }),
];

describe('the academics band on the home page', () => {
  it('introduces itself, because nothing above it has', () => {
    render(<AcademicsSection courses={COURSES} />);
    expect(screen.getByText('Academics')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Programmes for every stage' })).toBeInTheDocument();
  });
});

describe('the same section as the whole /academics page', () => {
  it('drops its own eyebrow and heading — the page masthead already said it', () => {
    render(<AcademicsSection courses={COURSES} onOwnPage />);
    expect(screen.queryByText('Academics')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Programmes for every stage' })).not.toBeInTheDocument();
  });

  it('still renders every programme — only the duplicated heading goes', () => {
    render(<AcademicsSection courses={COURSES} onOwnPage />);
    expect(screen.getByText('Preschool (Nursery–UKG)')).toBeInTheDocument();
    expect(screen.getByText('Primary (I–V)')).toBeInTheDocument();
  });

  it('renders nothing at all when the school has no programmes', () => {
    const { container } = render(<AcademicsSection courses={[]} onOwnPage />);
    expect(container).toBeEmptyDOMElement();
  });
});
