/**
 * WHOSE PROBLEM IS THIS FAILURE?
 *
 * The school's WhatsApp card counted every failed message as a "number to
 * fix". On staging that read as 8 numbers to chase when 7 of the 8 were ours:
 * six from an expired token and one from a sender id that pointed at the
 * business account instead of the phone. A school ringing seven parents about
 * a problem in our own environment is worse than showing nothing.
 *
 * Meta's codes split cleanly, so the card can say which kind of problem it is
 * and who can actually do something about it.
 */
export type FailureBlame = 'SETUP' | 'RECIPIENT' | 'CONTENT' | 'UNKNOWN';

/** Meta error code → who has to act. */
export function failureBlame(code: number | null | undefined): FailureBlame {
  switch (code) {
    // Ours: the connection to Meta is wrong or has lapsed.
    case 190:     // token expired or invalid
    case 100:     // bad parameter — usually the phone number id
    case 131030:  // recipient not on the allow-list (the account is still in development)
    case 133010:  // the number is not registered
    case 131031:  // the account has been restricted
      return 'SETUP';
    // Ours, but about the message we asked for rather than the connection.
    case 132000:  // the number of variables does not match the template
    case 132001:  // no such template, or not approved in that language
    case 132005:  // the template text was changed and needs re-approval
    case 132007:  // the template content violates a policy
      return 'CONTENT';
    // Theirs: this phone cannot receive it.
    case 131026:  // undeliverable — not on WhatsApp, or cannot receive this kind
    case 131047:  // outside the 24-hour window and not a template
    case 131049:  // Meta chose not to deliver, to protect the user's experience
    case 470:     // the session window has expired
      return 'RECIPIENT';
    default:
      return 'UNKNOWN';
  }
}

/** What the school should be told to DO about a failure of this kind. */
export function failureAdvice(blame: FailureBlame): string {
  switch (blame) {
    case 'SETUP':
      return 'A problem with our WhatsApp connection, not with the family. Nothing for the school to chase.';
    case 'CONTENT':
      return 'The message template needs approval from Meta. Nothing for the school to chase.';
    case 'RECIPIENT':
      return 'This phone could not receive it — check the number is on WhatsApp.';
    default:
      return 'Cause unknown. The reason Meta gave is shown against the message.';
  }
}

/** Pull the numeric Meta code out of the reason we stored against a message. */
export function codeFromError(error: string | null | undefined): number | null {
  const m = /\(code (\d+)\)/.exec(error ?? '');
  return m ? Number(m[1]) : null;
}
