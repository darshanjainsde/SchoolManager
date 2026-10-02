/** Everything the generator writes that is a CHOICE rather than a calculation. */

export const SCHOOL = {
  slug: 'sample-school',
  name: 'Sample Public School',
  codePrefix: 'SPS',
  year: '2026-27',
  yearStart: '2026-04-01',
  yearEnd: '2027-03-31',
  /** "Today" for everything that is open, due or upcoming. */
  asOf: '2026-10-02',
  /** Attendance runs over four months, ending the day before asOf. */
  attFrom: '2026-06-01',
  attTo: '2026-10-01',
  emailDomain: 'sample.school',
  password: 'password',
};

export const FIRST_M = [
  'Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Sai', 'Reyansh', 'Krishna', 'Ishaan', 'Rudra', 'Kabir', 'Aryan',
  'Dhruv', 'Neel', 'Yash', 'Om', 'Rohan', 'Kian', 'Advait', 'Parth', 'Atharv', 'Shaurya', 'Ayaan', 'Zayan', 'Harsh',
  'Manav', 'Nikhil', 'Pranav', 'Samar', 'Tanish', 'Veer', 'Yuvraj', 'Dev', 'Hriday', 'Jay', 'Karan', 'Laksh', 'Mihir',
  'Naman', 'Ritvik', 'Sarthak', 'Tushar', 'Uday', 'Viraj', 'Anirudh', 'Devansh', 'Eshan', 'Faiz', 'Gaurav', 'Hrithik',
];
export const FIRST_F = [
  'Aadhya', 'Ananya', 'Diya', 'Ira', 'Myra', 'Anika', 'Navya', 'Kiara', 'Saanvi', 'Pari', 'Riya', 'Aisha', 'Meera',
  'Tara', 'Nitya', 'Avni', 'Ishita', 'Zara', 'Naina', 'Sara', 'Aarohi', 'Bhavya', 'Charvi', 'Damini', 'Esha', 'Falak',
  'Gargi', 'Harini', 'Inaya', 'Jiya', 'Kavya', 'Lavanya', 'Mahika', 'Nandini', 'Oviya', 'Prisha', 'Qirat', 'Rhea',
  'Siya', 'Trisha', 'Urvi', 'Vanya', 'Waridha', 'Yashvi', 'Zoya', 'Aditi', 'Bhumi', 'Chhavi', 'Disha', 'Eva',
];
export const SURNAMES = [
  'Sharma', 'Verma', 'Gupta', 'Agarwal', 'Singh', 'Khan', 'Patel', 'Shah', 'Mehta', 'Joshi', 'Kulkarni', 'Deshmukh',
  'Iyer', 'Nair', 'Menon', 'Reddy', 'Rao', 'Naidu', 'Banerjee', 'Chatterjee', 'Das', 'Mukherjee', 'Bose', 'Sen',
  'Kapoor', 'Malhotra', 'Chopra', 'Bhatia', 'Arora', 'Saxena', 'Mishra', 'Pandey', 'Tiwari', 'Yadav', 'Chauhan',
  'Rathore', 'Shekhawat', 'Jain', 'Bansal', 'Mittal', 'Goyal', 'Kaur', 'Gill', 'Sandhu', 'Fernandes', 'DSouza',
  'Thomas', 'George', 'Pillai', 'Bhosale',
];
export const MOTHER_FIRST = [
  'Sunita', 'Anita', 'Kavita', 'Rekha', 'Pooja', 'Neha', 'Priya', 'Seema', 'Meena', 'Radha', 'Geeta', 'Lata',
  'Shalini', 'Divya', 'Swati', 'Nisha', 'Rashmi', 'Usha', 'Vandana', 'Anjali', 'Ritu', 'Jyoti', 'Madhu', 'Sarika',
];
export const AREAS = [
  'Civil Lines', 'Model Town', 'Gandhi Nagar', 'Shastri Nagar', 'Vasant Vihar', 'Lake View Colony', 'Green Park',
  'Rose Garden', 'Sector 12', 'Sector 21', 'Ashok Nagar', 'Nehru Colony',
];
export const CITY = { name: 'Jaipur', state: 'Rajasthan', pin: '302017' };

/* ── grades and what each one studies ─────────────────────────────────────── */

export const GRADES = [
  'Nursery', 'LKG', 'UKG', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII',
] as const;
export const SECTIONS = ['A', 'B', 'C'] as const;

export const SUBJECTS: readonly (readonly [code: string, name: string])[] = [
  ['ENG', 'English'], ['HIN', 'Hindi'], ['MATH', 'Mathematics'], ['EVS', 'Environmental Studies'],
  ['SCI', 'Science'], ['SST', 'Social Science'], ['SKT', 'Sanskrit'], ['CS', 'Computer Science'],
  ['ART', 'Art & Craft'], ['PE', 'Physical Education'], ['PHY', 'Physics'], ['CHEM', 'Chemistry'],
  ['BIO', 'Biology'], ['ACC', 'Accountancy'], ['BST', 'Business Studies'], ['ECO', 'Economics'],
];

/** The subjects a section studies, by grade index and (for XI–XII) section letter. */
export function subjectsFor(g: number, section: string): string[] {
  if (g <= 2) return ['ENG', 'MATH', 'EVS', 'ART'];
  if (g <= 4) return ['ENG', 'HIN', 'MATH', 'EVS', 'CS', 'ART', 'PE'];
  if (g <= 7) return ['ENG', 'HIN', 'MATH', 'SCI', 'SST', 'CS', 'ART'];
  if (g <= 10) return ['ENG', 'HIN', 'MATH', 'SCI', 'SST', 'SKT', 'CS'];
  if (g <= 12) return ['ENG', 'HIN', 'MATH', 'SCI', 'SST', 'CS'];
  if (section === 'A') return ['ENG', 'PHY', 'CHEM', 'MATH', 'CS'];
  if (section === 'B') return ['ENG', 'PHY', 'CHEM', 'BIO', 'PE'];
  return ['ENG', 'ACC', 'BST', 'ECO', 'MATH'];
}

/**
 * Lessons per week for each subject, by grade (and section for XI–XII). Every
 * section has 7 teaching periods × 6 days = 42, and every plan below sums to
 * exactly 42 — `staffing.ts` asserts it, because a section with 41 lessons has an
 * empty period and one with 43 cannot be timetabled at all.
 */
export function weekly(g: number, letter: string): Record<string, number> {
  if (g <= 2) return { ENG: 8, MATH: 8, EVS: 8, ART: 9, PE: 9 };
  if (g <= 4) return { ENG: 8, HIN: 7, MATH: 8, EVS: 6, CS: 3, ART: 4, PE: 6 };
  if (g <= 7) return { ENG: 7, HIN: 6, MATH: 8, SCI: 6, SST: 5, CS: 3, ART: 3, PE: 4 };
  if (g <= 10) return { ENG: 7, HIN: 5, MATH: 7, SCI: 7, SST: 7, SKT: 4, CS: 3, PE: 2 };
  if (g <= 12) return { ENG: 7, HIN: 6, MATH: 8, SCI: 8, SST: 7, CS: 3, PE: 3 };
  if (letter === 'A') return { ENG: 7, PHY: 9, CHEM: 9, MATH: 10, CS: 7 };
  if (letter === 'B') return { ENG: 7, PHY: 10, CHEM: 10, BIO: 10, PE: 5 };
  return { ENG: 7, ACC: 9, BST: 9, ECO: 9, MATH: 8 };
}

export const PERIODS: readonly (readonly [string, string, string, 'CLASS' | 'BREAK'])[] = [
  ['I', '08:00', '08:45', 'CLASS'], ['II', '08:45', '09:30', 'CLASS'], ['III', '09:30', '10:15', 'CLASS'],
  ['Break', '10:15', '10:35', 'BREAK'], ['IV', '10:35', '11:20', 'CLASS'], ['V', '11:20', '12:05', 'CLASS'],
  ['VI', '12:05', '12:50', 'CLASS'], ['VII', '12:50', '13:35', 'CLASS'],
];

/* ── the 20 teachers ──────────────────────────────────────────────────────── */

export interface TeacherDef {
  first: string; last: string; gender: 'F' | 'M'; subjects: string[];
  designation: string; qualification: string; years: number; grossRupees: number; joined: string;
}
export const TEACHERS: TeacherDef[] = [
  { first: 'Rekha', last: 'Sinha', gender: 'F', subjects: ['ENG'], designation: 'Vice Principal & PGT English', qualification: 'M.A. English, B.Ed', years: 22, grossRupees: 82000, joined: '2012-07-02' },
  { first: 'Anita', last: 'Deshmukh', gender: 'F', subjects: ['ENG'], designation: 'TGT English', qualification: 'M.A. English, B.Ed', years: 11, grossRupees: 52000, joined: '2017-04-03' },
  { first: 'Pooja', last: 'Nair', gender: 'F', subjects: ['ENG'], designation: 'PRT English', qualification: 'B.A. English, B.El.Ed', years: 6, grossRupees: 36000, joined: '2021-04-01' },
  { first: 'Sandeep', last: 'Chauhan', gender: 'M', subjects: ['HIN'], designation: 'TGT Hindi', qualification: 'M.A. Hindi, B.Ed', years: 14, grossRupees: 50000, joined: '2015-07-01' },
  { first: 'Kavita', last: 'Mishra', gender: 'F', subjects: ['HIN', 'SKT'], designation: 'TGT Hindi & Sanskrit', qualification: 'M.A. Sanskrit, B.Ed', years: 9, grossRupees: 46000, joined: '2019-04-01' },
  { first: 'Rajesh', last: 'Kulkarni', gender: 'M', subjects: ['MATH'], designation: 'PGT Mathematics', qualification: 'M.Sc. Mathematics, B.Ed', years: 19, grossRupees: 74000, joined: '2013-04-01' },
  { first: 'Neha', last: 'Agarwal', gender: 'F', subjects: ['MATH'], designation: 'TGT Mathematics', qualification: 'M.Sc. Mathematics, B.Ed', years: 8, grossRupees: 48000, joined: '2018-07-02' },
  { first: 'Imran', last: 'Khan', gender: 'M', subjects: ['MATH'], designation: 'PRT Mathematics', qualification: 'B.Sc., B.Ed', years: 5, grossRupees: 34000, joined: '2025-06-02' },
  { first: 'Sunita', last: 'Rao', gender: 'F', subjects: ['SCI', 'EVS'], designation: 'TGT Science', qualification: 'M.Sc. Zoology, B.Ed', years: 10, grossRupees: 49000, joined: '2016-04-01' },
  { first: 'Arvind', last: 'Menon', gender: 'M', subjects: ['SCI', 'BIO'], designation: 'TGT Science', qualification: 'M.Sc. Botany, B.Ed', years: 12, grossRupees: 51000, joined: '2014-07-01' },
  { first: 'Vikram', last: 'Joshi', gender: 'M', subjects: ['PHY'], designation: 'PGT Physics', qualification: 'M.Sc. Physics, B.Ed', years: 17, grossRupees: 72000, joined: '2011-04-01' },
  { first: 'Shalini', last: 'Iyer', gender: 'F', subjects: ['CHEM'], designation: 'PGT Chemistry', qualification: 'M.Sc. Chemistry, B.Ed', years: 15, grossRupees: 70000, joined: '2013-07-01' },
  { first: 'Priya', last: 'Banerjee', gender: 'F', subjects: ['BIO'], designation: 'PGT Biology', qualification: 'M.Sc. Life Sciences, B.Ed', years: 13, grossRupees: 68000, joined: '2014-04-01' },
  { first: 'Manoj', last: 'Tiwari', gender: 'M', subjects: ['SST'], designation: 'TGT Social Science', qualification: 'M.A. History, B.Ed', years: 11, grossRupees: 50000, joined: '2016-07-01' },
  { first: 'Farah', last: 'Siddiqui', gender: 'F', subjects: ['SST', 'ECO'], designation: 'TGT Social Science', qualification: 'M.A. Economics, B.Ed', years: 7, grossRupees: 46000, joined: '2019-07-01' },
  { first: 'Rohit', last: 'Bansal', gender: 'M', subjects: ['ACC', 'BST', 'ECO'], designation: 'PGT Commerce', qualification: 'M.Com, CA Inter, B.Ed', years: 12, grossRupees: 66000, joined: '2015-04-01' },
  { first: 'Deepak', last: 'Saxena', gender: 'M', subjects: ['CS'], designation: 'PGT Computer Science', qualification: 'MCA, B.Ed', years: 9, grossRupees: 62000, joined: '2018-04-01' },
  { first: 'Gurpreet', last: 'Singh', gender: 'M', subjects: ['PE'], designation: 'Physical Education Teacher', qualification: 'M.P.Ed', years: 10, grossRupees: 40000, joined: '2017-07-03' },
  { first: 'Meenal', last: 'Kapoor', gender: 'F', subjects: ['ART'], designation: 'Art & Craft Teacher', qualification: 'B.F.A., B.Ed', years: 8, grossRupees: 36000, joined: '2019-04-01' },
  { first: 'Swati', last: 'Pandey', gender: 'F', subjects: ['EVS'], designation: 'Pre-Primary Coordinator', qualification: 'B.A., Montessori Diploma, B.Ed', years: 9, grossRupees: 38000, joined: '2018-07-02' },
];

/* ── non-teaching staff ───────────────────────────────────────────────────── */

export const STAFF: { first: string; last: string; role: 'OFFICE' | 'ACCOUNTS' | 'LIBRARIAN' | 'DRIVER' | 'SECURITY' | 'SUPPORT'; grossRupees: number }[] = [
  { first: 'Sunita', last: 'Kale', role: 'OFFICE', grossRupees: 28000 },
  { first: 'Meera', last: 'Joshi', role: 'ACCOUNTS', grossRupees: 34000 },
  { first: 'Ramesh', last: 'Pawar', role: 'LIBRARIAN', grossRupees: 30000 },
  { first: 'Asha', last: 'Gaikwad', role: 'OFFICE', grossRupees: 24000 },
  { first: 'Vijay', last: 'More', role: 'DRIVER', grossRupees: 21000 },
  { first: 'Santosh', last: 'Yadav', role: 'DRIVER', grossRupees: 20000 },
  { first: 'Prakash', last: 'Jadhav', role: 'SECURITY', grossRupees: 16500 },
  { first: 'Latha', last: 'Shinde', role: 'SUPPORT', grossRupees: 14500 },
  { first: 'Raju', last: 'Khan', role: 'SUPPORT', grossRupees: 13500 },
];

/* ── houses, holidays, rooms ──────────────────────────────────────────────── */

export const HOUSES = [
  { name: 'Aravali', color: '#DC2626' }, { name: 'Nilgiri', color: '#2563EB' },
  { name: 'Shivalik', color: '#16A34A' }, { name: 'Vindhya', color: '#D97706' },
];

export const HOLIDAYS: readonly (readonly [name: string, type: string, from: string, to?: string])[] = [
  ['Dr. Ambedkar Jayanti', 'NATIONAL', '2026-04-14'],
  ['Summer Vacation', 'VACATION', '2026-05-01', '2026-05-31'],
  ['Independence Day', 'NATIONAL', '2026-08-15'],
  ['Raksha Bandhan', 'FESTIVAL', '2026-08-28'],
  ['Janmashtami', 'FESTIVAL', '2026-09-04'],
  ['Ganesh Chaturthi', 'FESTIVAL', '2026-09-14'],
  ['Gandhi Jayanti', 'NATIONAL', '2026-10-02'],
  ['Dussehra', 'FESTIVAL', '2026-10-20'],
  ['Diwali Break', 'FESTIVAL', '2026-11-08', '2026-11-11'],
  ['Christmas', 'FESTIVAL', '2026-12-25'],
  ['Republic Day', 'NATIONAL', '2027-01-26'],
  ['Holi', 'FESTIVAL', '2027-03-22'],
];

export const ROOMS = ['Room 101', 'Room 102', 'Room 201', 'Room 202', 'Science Lab', 'Computer Lab'];

/* ── fees ─────────────────────────────────────────────────────────────────── */

export const FEE_CATEGORIES = [
  { name: 'Tuition', description: 'Classroom teaching, learning materials and school upkeep', frequency: 'PER_TERM', isOptional: false, order: 0 },
  { name: 'Admission', description: 'One-time charge when a student joins the school', frequency: 'ONE_TIME', isOptional: false, order: 1 },
  { name: 'Transport', description: 'School bus, by route — only if you use the bus', frequency: 'PER_TERM', isOptional: true, order: 2 },
  { name: 'Exam', description: 'Question papers, answer sheets and result processing', frequency: 'PER_TERM', isOptional: false, order: 3 },
  { name: 'Computer lab', description: 'Computer room, internet and software for practicals', frequency: 'PER_TERM', isOptional: false, order: 4 },
  { name: 'Library', description: 'Books, periodicals and reading room upkeep', frequency: 'PER_TERM', isOptional: false, order: 5 },
  { name: 'Activities', description: 'Sports, clubs, house events and annual functions', frequency: 'PER_TERM', isOptional: false, order: 6 },
] as const;

/** Rupees per term, by grade index. [from, to] inclusive. */
export const FEE_BANDS: { from: number; to: number; amounts: Record<string, number> }[] = [
  { from: 0, to: 2, amounts: { Tuition: 12000, Admission: 8000, Transport: 6000, Exam: 300, Library: 200, Activities: 800 } },
  { from: 3, to: 7, amounts: { Tuition: 15000, Admission: 9000, Transport: 6500, Exam: 500, 'Computer lab': 600, Library: 300, Activities: 1000 } },
  { from: 8, to: 10, amounts: { Tuition: 18000, Admission: 10000, Transport: 7000, Exam: 700, 'Computer lab': 800, Library: 350, Activities: 1200 } },
  { from: 11, to: 12, amounts: { Tuition: 22000, Admission: 12000, Transport: 7000, Exam: 900, 'Computer lab': 1000, Library: 400, Activities: 1200 } },
  { from: 13, to: 14, amounts: { Tuition: 26000, Admission: 14000, Transport: 7500, Exam: 1200, 'Computer lab': 1500, Library: 500, Activities: 1500 } },
];

/* ── the library ──────────────────────────────────────────────────────────── */

export const BOOKS: readonly (readonly [title: string, author: string, shelf: string])[] = [
  ['Panchatantra Stories', 'Vishnu Sharma', 'Stories'], ['Malgudi Days', 'R. K. Narayan', 'Fiction'],
  ['The Jungle Book', 'Rudyard Kipling', 'Fiction'], ['Alice in Wonderland', 'Lewis Carroll', 'Fiction'],
  ['Charlie and the Chocolate Factory', 'Roald Dahl', 'Fiction'], ['Matilda', 'Roald Dahl', 'Fiction'],
  ['The BFG', 'Roald Dahl', 'Fiction'], ["Harry Potter and the Philosopher's Stone", 'J. K. Rowling', 'Fiction'],
  ['Harry Potter and the Chamber of Secrets', 'J. K. Rowling', 'Fiction'], ['The Hobbit', 'J. R. R. Tolkien', 'Fiction'],
  ['Treasure Island', 'Robert Louis Stevenson', 'Fiction'], ['Black Beauty', 'Anna Sewell', 'Fiction'],
  ['Heidi', 'Johanna Spyri', 'Fiction'], ['Swami and Friends', 'R. K. Narayan', 'Fiction'],
  ['The Adventures of Tom Sawyer', 'Mark Twain', 'Fiction'], ['Gulliver’s Travels', 'Jonathan Swift', 'Fiction'],
  ['Wings of Fire', 'A. P. J. Abdul Kalam', 'Biography'], ['Ignited Minds', 'A. P. J. Abdul Kalam', 'Biography'],
  ['My Experiments with Truth', 'M. K. Gandhi', 'Biography'], ['The Story of My Life', 'Helen Keller', 'Biography'],
  ['The Diary of a Young Girl', 'Anne Frank', 'Biography'], ['Long Walk to Freedom', 'Nelson Mandela', 'Biography'],
  ['Discovery of India', 'Jawaharlal Nehru', 'History'], ['Glimpses of World History', 'Jawaharlal Nehru', 'History'],
  ['India After Gandhi (Young Readers)', 'Ramachandra Guha', 'History'], ['The Story of the Indian Constitution', 'Subhash Kashyap', 'History'],
  ['A Brief History of Time', 'Stephen Hawking', 'Science'], ['The Selfish Gene (Simplified)', 'Richard Dawkins', 'Science'],
  ['Cosmos', 'Carl Sagan', 'Science'], ['The Magic School Bus: Inside the Earth', 'Joanna Cole', 'Science'],
  ['Why Is the Sky Blue?', 'Marcus Chown', 'Science'], ['The Wonders of Chemistry', 'Isaac Asimov', 'Science'],
  ['Know Your Body', 'Dorling Kindersley', 'Science'], ['Ocean: A Children’s Encyclopedia', 'Dorling Kindersley', 'Science'],
  ['Atlas of the World', 'National Geographic', 'Reference'], ['Oxford Dictionary for Schools', 'Oxford University Press', 'Reference'],
  ['Concise Hindi–English Dictionary', 'R. S. McGregor', 'Reference'], ['Encyclopedia of General Knowledge', 'Arihant', 'Reference'],
  ['Pearson Concise Atlas', 'Pearson', 'Reference'], ['Children’s Book of Facts', 'Usborne', 'Reference'],
  ['Vedic Mathematics', 'Bharati Krishna Tirthaji', 'Mathematics'], ['The Man Who Counted', 'Malba Tahan', 'Mathematics'],
  ['Mathematical Puzzles', 'Shakuntala Devi', 'Mathematics'], ['Puzzles to Puzzle You', 'Shakuntala Devi', 'Mathematics'],
  ['Figuring Out Fractions', 'Joan Nelson', 'Mathematics'], ['The Number Devil', 'Hans Magnus Enzensberger', 'Mathematics'],
  ['Godaan', 'Munshi Premchand', 'Hindi'], ['Gaban', 'Munshi Premchand', 'Hindi'], ['Idgah', 'Munshi Premchand', 'Hindi'],
  ['Rashmirathi', 'Ramdhari Singh Dinkar', 'Hindi'], ['Madhushala', 'Harivansh Rai Bachchan', 'Hindi'],
  ['Chandrakanta', 'Devaki Nandan Khatri', 'Hindi'], ['Hitopadesh', 'Narayan Pandit', 'Hindi'],
  ['Tenali Rama Stories', 'Traditional', 'Stories'], ['Akbar–Birbal Tales', 'Traditional', 'Stories'],
  ['Jataka Tales', 'Traditional', 'Stories'], ['Aesop’s Fables', 'Aesop', 'Stories'],
  ['Grimm’s Fairy Tales', 'Brothers Grimm', 'Stories'], ['Hans Andersen’s Fairy Tales', 'Hans Christian Andersen', 'Stories'],
  ['Stories from the Mahabharata', 'C. Rajagopalachari', 'Stories'], ['Ramayana for Children', 'Amar Chitra Katha', 'Stories'],
  ['Amar Chitra Katha: Hanuman', 'Amar Chitra Katha', 'Comics'], ['Amar Chitra Katha: Rani of Jhansi', 'Amar Chitra Katha', 'Comics'],
  ['Tinkle Digest Collection', 'Tinkle', 'Comics'], ['Asterix the Gaul', 'René Goscinny', 'Comics'],
  ['The Adventures of Tintin: Cigars of the Pharaoh', 'Hergé', 'Comics'], ['Calvin and Hobbes Treasury', 'Bill Watterson', 'Comics'],
  ['Computer Basics for Kids', 'Sandeep Gupta', 'Computers'], ['Scratch Programming Playground', 'Al Sweigart', 'Computers'],
  ['Python for Kids', 'Jason Briggs', 'Computers'], ['How the Internet Works', 'Preston Gralla', 'Computers'],
  ['Introduction to Robotics', 'John Craig', 'Computers'], ['Digital Citizenship', 'Mike Ribble', 'Computers'],
  ['Chanakya Neeti', 'Chanakya', 'Reference'], ['Rich Dad Poor Dad (Teen)', 'Robert Kiyosaki', 'Commerce'],
  ['The Basics of Accounting', 'T. S. Grewal', 'Commerce'], ['Business Studies Made Easy', 'Sandeep Garg', 'Commerce'],
  ['Introductory Microeconomics', 'NCERT', 'Commerce'], ['Principles of Economics (Simplified)', 'N. Gregory Mankiw', 'Commerce'],
  ['Physics for Class XI', 'H. C. Verma', 'Senior'], ['Concepts of Physics Vol. 1', 'H. C. Verma', 'Senior'],
  ['Organic Chemistry Made Simple', 'Morrison & Boyd', 'Senior'], ['Biology Today', 'Trueman', 'Senior'],
  ['Mathematics for Class XII', 'R. D. Sharma', 'Senior'], ['English Grammar in Use', 'Raymond Murphy', 'Senior'],
  ['Word Power Made Easy', 'Norman Lewis', 'Senior'], ['Wren & Martin High School Grammar', 'Wren & Martin', 'Senior'],
  ['Chicken Soup for the Teenage Soul', 'Jack Canfield', 'Senior'], ['The Alchemist', 'Paulo Coelho', 'Senior'],
  ['To Kill a Mockingbird', 'Harper Lee', 'Senior'], ['Animal Farm', 'George Orwell', 'Senior'],
  ['The Diary of a Wimpy Kid', 'Jeff Kinney', 'Fiction'], ['Geronimo Stilton: Lost Treasure', 'Geronimo Stilton', 'Fiction'],
  ['Famous Five: Five on a Treasure Island', 'Enid Blyton', 'Fiction'], ['The Secret Seven', 'Enid Blyton', 'Fiction'],
  ['Mr. Men: Little Miss Sunshine', 'Roger Hargreaves', 'Early Readers'], ['The Very Hungry Caterpillar', 'Eric Carle', 'Early Readers'],
  ['Brown Bear, Brown Bear', 'Bill Martin Jr.', 'Early Readers'], ['Goodnight Moon', 'Margaret Wise Brown', 'Early Readers'],
  ['A Is for Apple (Picture Book)', 'Usborne', 'Early Readers'], ['My First Hindi Words', 'Usborne', 'Early Readers'],
  ['Nursery Rhymes Treasury', 'Ladybird', 'Early Readers'], ['Dr. Seuss: The Cat in the Hat', 'Dr. Seuss', 'Early Readers'],
];

/* ── words ────────────────────────────────────────────────────────────────── */

/** Diary homework lines by subject. `{n}` and `{m}` are filled with small numbers. */
export const HOMEWORK: Record<string, string[]> = {
  ENG: ['Learn the spellings from the word list and write each three times.', 'Read Chapter {n} aloud at home and write five new words with their meanings.', 'Complete the grammar worksheet on tenses.', 'Write a short paragraph on "My Favourite Festival".'],
  HIN: ['अध्याय {n} का सुलेख लिखें और शब्दार्थ याद करें।', 'Learn the poem of Lesson {n} and recite it in class.', 'Complete the Hindi grammar worksheet (sangya and sarvanam).', 'Write a letter to your friend in Hindi.'],
  MATH: ['Solve Exercise {n}.{m}, questions 1 to 10 in the notebook.', 'Revise the tables of {n} and be ready for oral questions.', 'Complete the worksheet on fractions.', 'Practise the formula sheet of the chapter taught today.'],
  EVS: ['Draw and label the parts of a plant.', 'Collect three leaves and paste them in your scrapbook.', 'Learn the answers of Lesson {n} (oral).', 'Write five things we can do to save water.'],
  SCI: ['Answer the intext questions of Chapter {n}.', 'Draw and label the diagram taught in class.', 'Prepare for the viva on Chapter {n}.', 'Complete the activity sheet and paste it in the notebook.'],
  SST: ['Learn the map work of Chapter {n} and mark on the outline map.', 'Write the answers to the questions at the end of Chapter {n}.', 'Prepare a short chart on the topic discussed in class.', 'Revise the dates and events of the lesson.'],
  SKT: ['श्लोक {n} कण्ठस्थ करें।', 'Write the shabd roop of the words taught today.', 'Complete the translation exercise.'],
  CS: ['Practise the shortcut keys taught in the lab.', 'Write the steps of the program in your notebook.', 'Complete the worksheet on the parts of a computer.'],
  ART: ['Bring colour pencils and a drawing sheet for the next class.', 'Complete the pattern drawing started in class.', 'Collect waste material for the craft project.'],
  PE: ['Wear the sports uniform and shoes on the days of PE.', 'Practise the warm-up routine for ten minutes at home.'],
  PHY: ['Solve the numericals given at the end of Chapter {n}.', 'Revise the derivations of the chapter and be ready for a class test.', 'Complete the practical file entry for the last experiment.'],
  CHEM: ['Balance the equations given in the worksheet.', 'Write the IUPAC names of the compounds listed on the board.', 'Complete the practical file entry for the last experiment.'],
  BIO: ['Draw and label the diagrams of Chapter {n}.', 'Complete the practical file entry for the last experiment.', 'Revise the flow charts of the chapter.'],
  ACC: ['Pass the journal entries given in the exercise.', 'Prepare the ledger accounts of the problem solved in class.'],
  BST: ['Prepare notes on the case study discussed in class.', 'Read the chapter on forms of business organisation.'],
  ECO: ['Solve the numerical questions of Chapter {n}.', 'Read the newspaper article on inflation and write a summary.'],
};

export const CLASS_NOTES = [
  'Revised the previous chapter and took a short oral quiz; most of the class was confident.',
  'Introduced the new chapter with an activity. A few students need help with the basics.',
  'Class test conducted. Copies will be returned in the next period.',
  'Group activity completed; every group presented their findings.',
  'Syllabus on track. Revision worksheet will be given before the next unit test.',
  'Students were slightly restless today; revision games helped to settle the class.',
];

export const REMARKS_POSITIVE = [
  '{n} has been very attentive in class this week.',
  '{n} helped a classmate understand the lesson today — well done.',
  'Excellent participation by {n} in today’s discussion.',
  '{n}’s notebook work has improved a lot. Keep it up.',
  '{n} scored well in the class test and showed real effort.',
];
export const REMARKS_CONCERN = [
  '{n} did not complete the homework on three days this week. Please check the diary daily.',
  '{n} was late to school several times this week. Kindly ensure timely arrival.',
  '{n} was talking during the lesson and needs to focus more in class.',
  '{n} has not been carrying the required books. Please check the timetable at home.',
  '{n} needs extra practice in the last chapter. A little revision every day will help.',
];

export const REPORT_REMARKS: { min: number; texts: string[] }[] = [
  { min: 85, texts: [
    '{n} has had an outstanding half-year. Consistent, curious and a role model for the class.',
    'An excellent performance across subjects. {n} participates actively and leads by example.',
    '{n} has worked with great discipline this term. Keep aiming higher.',
  ] },
  { min: 70, texts: [
    '{n} has done well this term and shows steady improvement. A little more revision will lift the results further.',
    'A good half-year. {n} is attentive and sincere; written work can be more regular.',
    '{n} understands concepts well. Practising problems regularly will bring even better results.',
  ] },
  { min: 55, texts: [
    '{n} has made a fair effort. Regular revision and timely submission of work will help improve the marks.',
    'A satisfactory performance. {n} can do better with more focus in class and daily practice at home.',
    '{n} is capable of more. Please encourage a fixed study routine at home.',
  ] },
  { min: 0, texts: [
    '{n} needs more support this term. We suggest regular practice at home and a meeting with the class teacher.',
    'Performance is below expectation. {n} will benefit from extra practice, and we will work on it together.',
    '{n} finds some topics difficult. Remedial help is being arranged; your support at home will matter.',
  ] },
];

export const ANNOUNCEMENTS: readonly (readonly [title: string, body: string, daysAgo: number])[] = [
  ['Half-Yearly results and PTM', 'Half-Yearly results will be shared with parents in the Parent–Teacher Meeting on 26 September. Please carry the diary.', 8],
  ['Gandhi Jayanti — school closed', 'The school will remain closed on Friday, 2 October on account of Gandhi Jayanti.', 1],
  ['New library hours', 'The library is now open until 4:30 pm on weekdays. Books can be issued during the second break as well.', 14],
  ['Inter-house sports day', 'The Inter-House Sports Day is on 19 September. Students should wear their house colour t-shirt.', 14],
  ['Fee reminder — Term 2', 'Term 2 fees were due on 10 August. Parents who have not paid are requested to do so at the earliest to avoid the late fee.', 40],
  ['Bus timing change', 'From Monday the morning bus routes 2 and 3 will leave ten minutes earlier due to road work on the main road.', 22],
  ['Teachers’ Day celebration', 'Students of classes VI to XII will present a programme on Teachers’ Day on 5 September.', 28],
  ['Uniform check', 'Students must come in complete school uniform from Monday. Kindly replace worn-out shoes and ties.', 35],
  ['Science exhibition', 'The annual Science and Maths Exhibition will be held on 8 August. Participants should register with their class teachers.', 55],
  ['Monsoon safety', 'Parents are requested to send raincoats and a spare set of socks during the rainy season.', 70],
  ['Welcome to the new session', 'Welcome back to all students and parents. The session 2026–27 begins on 1 June.', 123],
  ['Hindi Diwas assembly', 'A special assembly will be held on 14 September to celebrate Hindi Diwas.', 22],
];

export interface EventDef {
  title: string; on: string; from: string; to: string; venue: string; description: string;
  tickets: { name: string; capacity: number }[]; registered: number; checkedIn: boolean;
}
export const EVENTS: EventDef[] = [
  { title: 'Welcome Back Assembly & Orientation', on: '2026-06-03', from: '08:00', to: '10:00', venue: 'School Auditorium', description: 'The first assembly of the new session, with a welcome for new students and an orientation for parents of Nursery and Class I.', tickets: [{ name: 'Open to all', capacity: 600 }], registered: 0, checkedIn: false },
  { title: 'World Environment Day — Plantation Drive', on: '2026-06-05', from: '09:00', to: '11:30', venue: 'School Campus', description: 'Every class plants a sapling and adopts it for the year.', tickets: [{ name: 'Students', capacity: 1500 }], registered: 220, checkedIn: true },
  { title: 'International Yoga Day', on: '2026-06-20', from: '07:00', to: '08:30', venue: 'Main Ground', description: 'A mass yoga session led by our physical education team.', tickets: [{ name: 'Students', capacity: 1500 }], registered: 260, checkedIn: true },
  { title: 'Inter-School Debate Competition', on: '2026-07-18', from: '10:00', to: '14:00', venue: 'School Auditorium', description: 'Eight schools of the city debate on "Technology in the classroom".', tickets: [{ name: 'Participants', capacity: 40 }, { name: 'Audience', capacity: 300 }], registered: 90, checkedIn: true },
  { title: 'Science & Maths Exhibition', on: '2026-08-08', from: '09:30', to: '13:00', venue: 'Activity Hall', description: 'Working models, charts and experiments by students of classes III to XII.', tickets: [{ name: 'Exhibitors', capacity: 200 }, { name: 'Visitors', capacity: 800 }], registered: 240, checkedIn: true },
  { title: 'Independence Day Celebration', on: '2026-08-15', from: '08:00', to: '10:30', venue: 'Main Ground', description: 'Flag hoisting, march past and cultural programme.', tickets: [{ name: 'Students', capacity: 1500 }], registered: 0, checkedIn: false },
  { title: 'Teachers’ Day Programme', on: '2026-09-05', from: '09:00', to: '12:00', venue: 'School Auditorium', description: 'Students of classes VI to XII honour their teachers with a programme.', tickets: [{ name: 'Performers', capacity: 150 }], registered: 130, checkedIn: true },
  { title: 'Inter-House Sports Day', on: '2026-09-19', from: '07:30', to: '13:00', venue: 'Sports Ground', description: 'Track and field events between the four houses, with a march past and prize distribution.', tickets: [{ name: 'Participants', capacity: 400 }, { name: 'Spectators', capacity: 600 }], registered: 380, checkedIn: true },
  { title: 'Parent–Teacher Meeting — Half-Yearly Results', on: '2026-09-26', from: '09:00', to: '13:00', venue: 'Classrooms', description: 'Parents meet class teachers to discuss the Half-Yearly results and the progress of their child.', tickets: [{ name: 'Parents', capacity: 1500 }], registered: 0, checkedIn: false },
  { title: 'Annual Book Fair', on: '2026-10-10', from: '09:00', to: '15:00', venue: 'Library Hall', description: 'Books for every age, with 10% of sales donated to the school library.', tickets: [{ name: 'Open to all', capacity: 1000 }], registered: 0, checkedIn: false },
  { title: 'Diwali Mela & Rangoli Competition', on: '2026-10-31', from: '10:00', to: '14:00', venue: 'School Grounds', description: 'Class stalls, rangoli, diya painting and a food court run by parents and students.', tickets: [{ name: 'Rangoli participants', capacity: 120 }, { name: 'Visitors', capacity: 800 }], registered: 210, checkedIn: false },
  { title: 'Children’s Day Carnival', on: '2026-11-14', from: '09:00', to: '13:00', venue: 'School Campus', description: 'Games, magic show and a special lunch for the little ones.', tickets: [{ name: 'Students', capacity: 1500 }], registered: 140, checkedIn: false },
  { title: 'Annual Day — "Rangmanch"', on: '2026-12-18', from: '16:00', to: '20:00', venue: 'School Auditorium', description: 'The annual cultural evening: dance, drama and music by students of every class.', tickets: [{ name: 'Performers', capacity: 400 }, { name: 'Parents & guests', capacity: 700 }], registered: 330, checkedIn: false },
];

export const ENQUIRIES: readonly (readonly [parent: string, grade: string, message: string])[] = [
  ['Mr. Rakesh Gupta', 'Nursery', 'We would like to visit the school and know the fee structure for Nursery.'],
  ['Mrs. Anjali Verma', 'LKG', 'Is the bus facility available from Vasant Vihar?'],
  ['Mr. Sanjay Mehta', 'Class VI', 'Looking for a seat in Class VI for the next session.'],
  ['Mrs. Pooja Reddy', 'UKG', 'Please share the admission dates and documents needed.'],
  ['Mr. Imtiyaz Ahmed', 'Class IX', 'Transferring from another city. Is a mid-session admission possible?'],
  ['Mrs. Kavita Joshi', 'Class I', 'Do you take students without a pre-primary certificate?'],
  ['Mr. Harpreet Singh', 'Class XI', 'Interested in the Commerce stream. What is the eligibility?'],
  ['Mrs. Shweta Agarwal', 'Nursery', 'Need details of the school timings and the daycare option.'],
  ['Mr. Anil Kumar', 'Class III', 'Wanted to know about the school’s activities and clubs.'],
  ['Mrs. Farhana Khan', 'Class VII', 'Looking for admission for my daughter after a relocation.'],
  ['Mr. Vivek Nair', 'Class XI', 'Does the school offer Physics–Chemistry–Biology with Physical Education?'],
  ['Mrs. Deepa Shah', 'LKG', 'Can we visit on Saturday for a tour?'],
  ['Mr. Rohit Saxena', 'Class V', 'Please send the prospectus and the fee details.'],
  ['Mrs. Priyanka Das', 'Class II', 'Interested in admission; my son has completed Class I elsewhere.'],
  ['Mr. Mahesh Patel', 'Class VIII', 'What is the process for a sibling admission?'],
  ['Mrs. Sunanda Iyer', 'Nursery', 'Is there a waiting list for Nursery next year?'],
  ['Mr. Tarun Bansal', 'Class X', 'Enquiring about the board classes and coaching support.'],
  ['Mrs. Rubina Siddiqui', 'UKG', 'Do you provide meals at school?'],
  ['Mr. Naveen Chopra', 'Class IV', 'Moving to Jaipur next month; need an urgent admission.'],
  ['Mrs. Lalita Mishra', 'Class XII', 'Want to know whether a transfer is possible in Class XII.'],
];
