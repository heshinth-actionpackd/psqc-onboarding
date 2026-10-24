/**
 * Approved WhatsApp template names sent through Actionpackd.
 *
 * TODO: replace `courseChoice` with the name that is APPROVED on the
 * Actionpackd number before the course step can deliver. The template's
 * quick-reply button payloads must be exactly `fundamental` and `advanced`
 * (titles can be "Fundamental" and "Advanced"). Buttons are part of the
 * approved template; they are not sent on the API request.
 */
export const TEMPLATE_NAMES = {
  courseChoice: "TODO_psqc_course_choice",
} as const;
