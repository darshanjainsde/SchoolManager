import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { PublicCourse } from '@/lib/public-api';
import CoursesFeatured from './CoursesFeatured';
import { submitEnquiry } from '../enquiry-client';

vi.mock('../enquiry-client', () => ({ submitEnquiry: vi.fn().mockResolvedValue('ok') }));

const NURSERY: PublicCourse = {
  id: 'c1', name: 'Nursery', tagline: 'Play comes first', description: null, highlights: [],
  ageRange: '3–4 years', imageUrl: null, featured: true, fee: null, hallOfFame: [],
};

describe('the course flip card', () => {
  /** The admissions desk shows where each lead came from; this one is not the contact form. */
  it('tells the desk the call-back came from a course card', async () => {
    render(<CoursesFeatured courses={[NURSERY]} />);
    fireEvent.change(screen.getByLabelText('Phone number for Nursery enquiry'), { target: { value: '98290 11223' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request a call' }));
    await waitFor(() =>
      expect(submitEnquiry).toHaveBeenCalledWith(expect.objectContaining({
        phone: '98290 11223', gradeInterest: 'Nursery', source: 'COURSE_CARD',
      })),
    );
  });
});
