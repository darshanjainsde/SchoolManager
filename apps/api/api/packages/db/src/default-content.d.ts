/**
 * Default public-site courses created for every new school (any tier).
 * Editable by the school admin from Website config → Courses; purely CMS
 * content, unrelated to the Management (Pro) Grade model.
 */
export declare const DEFAULT_COURSES: readonly [{
    readonly name: "Nursery & Pre-K";
    readonly tagline: "Play-based early years where every child is known by name.";
    readonly ageRange: "Ages 3–5";
    readonly highlights: readonly ["Low student–teacher ratio", "Activity-based learning", "Daily outdoor play"];
    readonly featured: true;
}, {
    readonly name: "Primary School";
    readonly tagline: "Strong foundations in literacy, numeracy and curiosity.";
    readonly ageRange: "Grades 1–5";
    readonly highlights: readonly ["Reading programme", "Hands-on math", "Annual science fair"];
    readonly featured: true;
}, {
    readonly name: "Middle School";
    readonly tagline: "Project weeks, labs and the first taste of electives.";
    readonly ageRange: "Grades 6–8";
    readonly highlights: readonly ["Science labs", "Project-based terms", "Language electives"];
    readonly featured: false;
}, {
    readonly name: "Secondary";
    readonly tagline: "Board-exam readiness with mentoring beyond marks.";
    readonly ageRange: "Grades 9–10";
    readonly highlights: readonly ["Exam preparation", "Career counselling", "Mentoring"];
    readonly featured: true;
}];
//# sourceMappingURL=default-content.d.ts.map