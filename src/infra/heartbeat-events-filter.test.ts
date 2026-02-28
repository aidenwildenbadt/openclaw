import { describe, expect, it } from "vitest";
import {
  buildCronEventPrompt,
  buildExecEventPrompt,
  isInternalCronInstructionEvent,
  shouldRelayCronEventsToUser,
} from "./heartbeat-events-filter.js";

describe("heartbeat event prompts", () => {
  it("builds user-relay cron prompt by default", () => {
    const prompt = buildCronEventPrompt(["Cron: rotate logs"]);
    expect(prompt).toContain("Please relay this reminder to the user");
  });

  it("builds internal-only cron prompt when delivery is disabled", () => {
    const prompt = buildCronEventPrompt(["Cron: rotate logs"], { deliverToUser: false });
    expect(prompt).toContain("Handle this reminder internally");
    expect(prompt).not.toContain("Please relay this reminder to the user");
  });

  it("builds internal-only exec prompt when delivery is disabled", () => {
    const prompt = buildExecEventPrompt({ deliverToUser: false });
    expect(prompt).toContain("Handle the result internally");
    expect(prompt).not.toContain("Please relay the command output to the user");
  });

  it("classifies runbook cron instructions as internal-only", () => {
    expect(
      isInternalCronInstructionEvent(
        "Run exec command: /tmp/job --json. If command exits cleanly, reply NO_REPLY. If it errors, send Kevin a short alert.",
      ),
    ).toBe(true);
  });

  it("allows relaying plain reminders but blocks internal runbook instructions", () => {
    expect(shouldRelayCronEventsToUser(["Reminder: Submit tax docs"])).toBe(true);
    expect(
      shouldRelayCronEventsToUser([
        "Run exec command: /tmp/job --json. If command exits cleanly, reply NO_REPLY. If it errors, send Kevin a short alert.",
      ]),
    ).toBe(false);
  });
});
