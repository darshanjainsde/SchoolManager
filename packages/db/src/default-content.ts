/**
 * Default public-site courses created for every new school (any tier).
 * Editable by the school admin from Website config → Courses; purely CMS
 * content, unrelated to the Management (Pro) Grade model.
 */
export const DEFAULT_COURSES = [
  {
    name: 'Nursery & Pre-K',
    tagline: 'Play-based early years where every child is known by name.',
    ageRange: 'Ages 3–5',
    highlights: ['Low student–teacher ratio', 'Activity-based learning', 'Daily outdoor play'],
    featured: true,
  },
  {
    name: 'Primary School',
    tagline: 'Strong foundations in literacy, numeracy and curiosity.',
    ageRange: 'Grades 1–5',
    highlights: ['Reading programme', 'Hands-on math', 'Annual science fair'],
    featured: true,
  },
  {
    name: 'Middle School',
    tagline: 'Project weeks, labs and the first taste of electives.',
    ageRange: 'Grades 6–8',
    highlights: ['Science labs', 'Project-based terms', 'Language electives'],
    featured: false,
  },
  {
    name: 'Secondary',
    tagline: 'Board-exam readiness with mentoring beyond marks.',
    ageRange: 'Grades 9–10',
    highlights: ['Exam preparation', 'Career counselling', 'Mentoring'],
    featured: true,
  },
] as const;
