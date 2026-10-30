import {
  hasLtiAgsScope,
  LTI_AGS_SCOPE_SCORE,
  LTI_AGS_SCOPE_LINEITEM_READONLY,
  type LTISession,
} from '@longsightgroup/lti-tool';

import type { ScoreSubmissionAvailability } from './contracts.js';

/** Determines whether the current launch can submit its user's grade to a linked LMS column. */
export function scoreSubmissionAvailability(
  session: LTISession,
): ScoreSubmissionAvailability {
  if (session.services?.deepLinking)
    return {
      available: false,
      code: 'deep_linking_selection',
      guidance:
        'Return an activity to the LMS, then launch the added course link to submit a score.',
    };
  if (!session.user.id)
    return {
      available: false,
      code: 'user_identifier_required',
      guidance: 'The LMS must supply a user identifier before a score can be submitted.',
    };
  if (!session.services?.ags?.lineitem)
    return {
      available: false,
      code: 'service_not_available',
      guidance:
        'This launch has no linked gradebook column. Enable grading in the LMS or add a graded activity through Deep Linking.',
    };
  if (!hasLtiAgsScope(session, LTI_AGS_SCOPE_SCORE))
    return {
      available: false,
      code: 'missing_required_scope',
      guidance:
        'The LMS did not grant the AGS score scope. Enable score submission in the tool installation and launch again.',
    };
  if (!hasLtiAgsScope(session, LTI_AGS_SCOPE_LINEITEM_READONLY))
    return {
      available: false,
      code: 'missing_required_scope',
      guidance:
        'The LMS must grant AGS lineitem or lineitem.readonly permission so the tool can read the column maximum.',
    };
  return { available: true };
}
