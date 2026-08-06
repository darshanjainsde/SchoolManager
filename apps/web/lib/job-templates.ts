import { MAX_QUESTIONS, type JobQuestionDraft } from './jobs-admin';

/**
 * Starting points for the roles Indian schools actually hire for.
 *
 * A blank vacancy form asks a school office to write a job description AND
 * invent four screening questions inside a budget they have never met before.
 * The prose they can manage; the questions are the hard part, because a
 * question that cannot become a filter is one somebody reads sixty times and
 * acts on none of.
 *
 * So the templates carry the QUESTIONS first and the words second. Every one of
 * them is within the four-question cap and — with at most one deliberate
 * exception per template — filterable, which is what makes the applications
 * desk usable on day one rather than after a school has learned the hard way.
 *
 * Client-side presets, not rows: a template is a starting point a school edits
 * immediately, so storing them would create a second thing to keep in step with
 * no benefit. Nothing here needs a migration.
 */
export interface JobTemplate {
  value: string;
  label: string;
  /** Who this is for, in the words a head would use. */
  hint: string;
  fields: {
    title: string;
    summary: string;
    description: string;
    employmentType: 'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'TEMPORARY';
    subject?: string;
  };
  questions: JobQuestionDraft[];
}

const YEARS: JobQuestionDraft = {
  prompt: 'Years of teaching experience',
  kind: 'NUMBER',
  options: [],
  required: true,
};

const CAN_START: JobQuestionDraft = {
  prompt: 'When can you start?',
  kind: 'CHOICE',
  options: ['Immediately', 'Within a month', 'Next term', 'Next academic year'],
  required: true,
};

export const JOB_TEMPLATES: JobTemplate[] = [
  {
    value: 'SUBJECT_TEACHER',
    label: 'Subject teacher',
    hint: 'Middle or senior school, one or two subjects.',
    fields: {
      title: 'Subject Teacher',
      summary: 'Teach your subject across middle and senior school.',
      description:
        'About the role\n\nYou will plan and teach your subject to classes across middle and senior school, set and mark assessments, and report to families each term.\n\nWhat we are looking for\n\n- A degree in the subject and a teaching qualification\n- Classroom experience with this age group\n- Someone who enjoys the pastoral side as much as the teaching\n\nWhat we offer\n\n[Describe your school, the department and anything a candidate would want to know.]',
      employmentType: 'FULL_TIME',
      subject: '',
    },
    questions: [
      { prompt: 'Which subject do you teach?', kind: 'CHOICE', options: ['English', 'Maths', 'Science', 'Social Science', 'Hindi', 'Computer Science', 'Other'], required: true },
      YEARS,
      { prompt: 'Do you hold a B.Ed or equivalent?', kind: 'YES_NO', options: [], required: true },
      CAN_START,
    ],
  },
  {
    value: 'PRIMARY_TEACHER',
    label: 'Primary class teacher',
    hint: 'A class of their own, Classes I–V.',
    fields: {
      title: 'Primary Class Teacher',
      summary: 'Take a primary class as their own teacher for the year.',
      description:
        'About the role\n\nYou will be the class teacher for one primary section — the person who knows every child in the room, teaches most of their subjects, and is the first point of contact for their family.\n\nWhat we are looking for\n\n- Experience teaching Classes I to V\n- Patience, warmth and good classroom routines\n- Comfort with phonics and early numeracy\n\nWhat we offer\n\n[Describe your school and the primary team.]',
      employmentType: 'FULL_TIME',
    },
    questions: [
      YEARS,
      { prompt: 'Do you hold a B.Ed, D.El.Ed or equivalent?', kind: 'YES_NO', options: [], required: true },
      { prompt: 'Which classes have you taught?', kind: 'CHOICE', options: ['Pre-primary', 'Classes I–II', 'Classes III–V', 'Mixed primary'], required: true },
      CAN_START,
    ],
  },
  {
    value: 'EARLY_YEARS',
    label: 'Early years teacher',
    hint: 'Nursery to UKG, where temperament matters most.',
    fields: {
      title: 'Early Years Teacher',
      summary: 'Nursery to UKG — a child’s first experience of school.',
      description:
        'About the role\n\nYou will teach our youngest children, for many of whom this is their first time away from home. The day is play-led, routine-heavy and physical.\n\nWhat we are looking for\n\n- Early years training (NTT, ECCE or equivalent)\n- Genuine patience — this is the whole job\n- Confidence talking to anxious parents\n\nWhat we offer\n\n[Describe your early years setting.]',
      employmentType: 'FULL_TIME',
    },
    questions: [
      { prompt: 'Do you have early years training (NTT / ECCE)?', kind: 'YES_NO', options: [], required: true },
      YEARS,
      CAN_START,
    ],
  },
  {
    value: 'TEACHING_ASSISTANT',
    label: 'Teaching assistant',
    hint: 'Support in the classroom, often part time.',
    fields: {
      title: 'Teaching Assistant',
      summary: 'Support a class teacher and the children who need extra help.',
      description:
        'About the role\n\nYou will work alongside a class teacher, giving individual and small-group support to the children who need it most.\n\nWhat we are looking for\n\n- Graduate, or studying towards a teaching qualification\n- Steady, calm and reliable\n\nWhat we offer\n\n[Describe the role and hours.]',
      employmentType: 'PART_TIME',
    },
    questions: [
      { prompt: 'Are you looking for full time or part time?', kind: 'CHOICE', options: ['Full time', 'Part time', 'Either'], required: true },
      YEARS,
      CAN_START,
    ],
  },
  {
    value: 'SPORTS_COACH',
    label: 'Sports coach / PE',
    hint: 'Games, fixtures and the annual meet.',
    fields: {
      title: 'Sports Coach',
      summary: 'Run games lessons and coach our school teams.',
      description:
        'About the role\n\nYou will take PE lessons across the school, coach at least one sport competitively, and run the annual sports meet.\n\nWhat we are looking for\n\n- A sports science or physical education qualification\n- Coaching experience with school-age children\n- First aid awareness\n\nWhat we offer\n\n[Describe your grounds, facilities and fixtures.]',
      employmentType: 'FULL_TIME',
    },
    questions: [
      { prompt: 'Which sport do you coach to a competitive level?', kind: 'CHOICE', options: ['Athletics', 'Cricket', 'Football', 'Basketball', 'Badminton', 'Swimming', 'Other'], required: true },
      YEARS,
      { prompt: 'Are you first-aid certified?', kind: 'YES_NO', options: [], required: false },
      CAN_START,
    ],
  },
  {
    value: 'SPECIAL_EDUCATOR',
    label: 'Special educator',
    hint: 'Learning support and inclusion.',
    fields: {
      title: 'Special Educator',
      summary: 'Support children with additional learning needs across the school.',
      description:
        'About the role\n\nYou will assess and support children with additional needs, write and review their plans, and advise class teachers on adapting their lessons.\n\nWhat we are looking for\n\n- RCI registration or an equivalent qualification\n- Experience writing and reviewing individual plans\n- The confidence to coach other teachers\n\nWhat we offer\n\n[Describe your inclusion team and how it works.]',
      employmentType: 'FULL_TIME',
    },
    questions: [
      { prompt: 'Are you RCI registered?', kind: 'YES_NO', options: [], required: true },
      YEARS,
      CAN_START,
    ],
  },
  {
    value: 'FRONT_OFFICE',
    label: 'Office / admin',
    hint: 'Front desk, admissions enquiries, records.',
    fields: {
      title: 'Front Office Executive',
      summary: 'The first person families meet, in person and on the phone.',
      description:
        'About the role\n\nYou will run the front desk: greeting visitors, answering admissions enquiries, keeping records straight and supporting the school office.\n\nWhat we are looking for\n\n- Graduate with good spoken English and the local language\n- Comfortable with spreadsheets and school software\n- Unflappable with anxious parents\n\nWhat we offer\n\n[Describe the team and the hours.]',
      employmentType: 'FULL_TIME',
    },
    questions: [
      { prompt: 'Years of office or front-desk experience', kind: 'NUMBER', options: [], required: true },
      { prompt: 'Which languages do you speak fluently?', kind: 'CHOICE', options: ['English + Hindi', 'English + regional', 'English only', 'Other combination'], required: true },
      CAN_START,
    ],
  },
  {
    value: 'BLANK',
    label: 'Start blank',
    hint: 'Write it yourself, with no questions to begin with.',
    fields: { title: '', summary: '', description: '', employmentType: 'FULL_TIME' },
    questions: [],
  },
];

/** A template is only useful if it fits the rules the service enforces. */
export function templateFits(t: JobTemplate): boolean {
  return t.questions.length <= MAX_QUESTIONS;
}
