export const copy = {
  promptStart(): string {
    return "Send Hi PSQC to start onboarding for the cohort.";
  },

  welcomeAskName(): string {
    return [
      "Welcome to PSQC. I'll register you for the cohort on this chat.",
      "Your WhatsApp number is the phone we'll use.",
      "",
      "What's your full name?",
    ].join("\n");
  },

  invalidName(): string {
    return "Please send your full name (up to 80 characters).";
  },

  askEmail(name: string): string {
    return `Thanks, ${name}. What's your email address?`;
  },

  invalidEmail(): string {
    return "That doesn't look like an email address. Please send it as name@example.com.";
  },

  askCollege(): string {
    return "Which college are you in?";
  },

  invalidCollege(): string {
    return "Please send your college name.";
  },

  invalidCourse(): string {
    return "Please choose a course using the buttons: Fundamental or Advanced.";
  },

  noOpenBatch(courseLabel: string): string {
    return `There isn't an open batch for ${courseLabel} yet. Reply YES to check again.`;
  },

  confirmBatch(courseLabel: string, batch: string): string {
    return `The open batch for ${courseLabel} is ${batch}. Reply YES to confirm.`;
  },

  chooseBatch(courseLabel: string, batches: string[]): string {
    const lines = batches.map((batch) => `- ${batch}`);
    return [
      `Which batch should we put you in for ${courseLabel}?`,
      ...lines,
      "Reply with the batch name.",
    ].join("\n");
  },

  invalidBatch(batches: string[]): string {
    const only = batches[0];
    if (batches.length === 0 || !only) return "No batch is open yet. Reply YES to check again.";
    if (batches.length === 1) return `Reply YES to confirm batch ${only}.`;
    return `Reply with one of these batches: ${batches.join(", ")}.`;
  },

  confirmed(courseLabel: string, batch: string, sessionDetails: string): string {
    return [`You're confirmed for ${courseLabel}, batch ${batch}.`, "", sessionDetails].join("\n");
  },

  alreadyEnrolled(courseLabel: string, batch: string, sessionDetails: string | null): string {
    const lines = [`You're already enrolled in ${courseLabel}, batch ${batch}.`];
    if (sessionDetails) lines.push("", sessionDetails);
    return lines.join("\n");
  },
};
