/**
 * Shared between the question builder and the applications desk.
 *
 * "Every screening question becomes a filter, automatically. A question that
 * cannot become a filter is one somebody reads sixty times and acts on none of.
 * Short text is the only non-filterable type and the builder says so."
 * — docs/PHASE6.md §6
 */
export const MAX_QUESTIONS = 4;

export type JobQuestionKind = 'CHOICE' | 'YES_NO' | 'NUMBER' | 'TEXT';

export interface JobQuestionDraft {
  prompt: string;
  kind: JobQuestionKind;
  options: string[];
  required: boolean;
}

/** TEXT is deliberately absent: it is the one kind a desk cannot filter on. */
export const filterableKinds: JobQuestionKind[] = ['CHOICE', 'YES_NO', 'NUMBER'];

export function isFilterable(kind: JobQuestionKind): boolean {
  return filterableKinds.includes(kind);
}
