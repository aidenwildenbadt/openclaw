import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { ImageContent } from "@mariozechner/pi-ai";
import { describe, expect, it, vi } from "vitest";
import {
  injectHistoryImagesIntoMessages,
  recoverOrphanedUserMessagesForPrompt,
  resolvePromptBuildHookResult,
  resolvePromptModeForSession,
} from "./attempt.js";

describe("injectHistoryImagesIntoMessages", () => {
  const image: ImageContent = { type: "image", data: "abc", mimeType: "image/png" };

  it("injects history images and converts string content", () => {
    const messages: AgentMessage[] = [
      {
        role: "user",
        content: "See /tmp/photo.png",
      } as AgentMessage,
    ];

    const didMutate = injectHistoryImagesIntoMessages(messages, new Map([[0, [image]]]));

    expect(didMutate).toBe(true);
    const firstUser = messages[0] as Extract<AgentMessage, { role: "user" }> | undefined;
    expect(Array.isArray(firstUser?.content)).toBe(true);
    const content = firstUser?.content as Array<{ type: string; text?: string; data?: string }>;
    expect(content).toHaveLength(2);
    expect(content[0]?.type).toBe("text");
    expect(content[1]).toMatchObject({ type: "image", data: "abc" });
  });

  it("avoids duplicating existing image content", () => {
    const messages: AgentMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "See /tmp/photo.png" }, { ...image }],
      } as AgentMessage,
    ];

    const didMutate = injectHistoryImagesIntoMessages(messages, new Map([[0, [image]]]));

    expect(didMutate).toBe(false);
    const first = messages[0] as Extract<AgentMessage, { role: "user" }> | undefined;
    if (!first || !Array.isArray(first.content)) {
      throw new Error("expected array content");
    }
    expect(first.content).toHaveLength(2);
  });

  it("ignores non-user messages and out-of-range indices", () => {
    const messages: AgentMessage[] = [
      {
        role: "assistant",
        content: "noop",
      } as unknown as AgentMessage,
    ];

    const didMutate = injectHistoryImagesIntoMessages(messages, new Map([[1, [image]]]));

    expect(didMutate).toBe(false);
    const firstAssistant = messages[0] as Extract<AgentMessage, { role: "assistant" }> | undefined;
    expect(firstAssistant?.content).toBe("noop");
  });
});

describe("resolvePromptBuildHookResult", () => {
  function createLegacyOnlyHookRunner() {
    return {
      hasHooks: vi.fn(
        (hookName: "before_prompt_build" | "before_agent_start") =>
          hookName === "before_agent_start",
      ),
      runBeforePromptBuild: vi.fn(async () => undefined),
      runBeforeAgentStart: vi.fn(async () => ({ prependContext: "from-hook" })),
    };
  }

  it("reuses precomputed legacy before_agent_start result without invoking hook again", async () => {
    const hookRunner = createLegacyOnlyHookRunner();
    const result = await resolvePromptBuildHookResult({
      prompt: "hello",
      messages: [],
      hookCtx: {},
      hookRunner,
      legacyBeforeAgentStartResult: { prependContext: "from-cache", systemPrompt: "legacy-system" },
    });

    expect(hookRunner.runBeforeAgentStart).not.toHaveBeenCalled();
    expect(result).toEqual({
      prependContext: "from-cache",
      systemPrompt: "legacy-system",
    });
  });

  it("calls legacy hook when precomputed result is absent", async () => {
    const hookRunner = createLegacyOnlyHookRunner();
    const messages = [{ role: "user", content: "ctx" }];
    const result = await resolvePromptBuildHookResult({
      prompt: "hello",
      messages,
      hookCtx: {},
      hookRunner,
    });

    expect(hookRunner.runBeforeAgentStart).toHaveBeenCalledTimes(1);
    expect(hookRunner.runBeforeAgentStart).toHaveBeenCalledWith({ prompt: "hello", messages }, {});
    expect(result.prependContext).toBe("from-hook");
  });
});

describe("resolvePromptModeForSession", () => {
  it("uses minimal mode for subagent sessions", () => {
    expect(resolvePromptModeForSession("agent:main:subagent:child")).toBe("minimal");
  });

  it("uses full mode for cron sessions", () => {
    expect(resolvePromptModeForSession("agent:main:cron:job-1")).toBe("full");
    expect(resolvePromptModeForSession("agent:main:cron:job-1:run:run-abc")).toBe("full");
  });
});

describe("recoverOrphanedUserMessagesForPrompt", () => {
  type LeafEntry = {
    id: string;
    type: "message" | "custom";
    parentId?: string | null;
    message?: AgentMessage;
  };

  function createSessionManager(entries: LeafEntry[], leafId: string | null) {
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    let currentLeafId = leafId;

    return {
      getLeafEntry: () => (currentLeafId ? byId.get(currentLeafId) : undefined),
      branch: (parentId: string) => {
        currentLeafId = parentId;
      },
      resetLeaf: () => {
        currentLeafId = null;
      },
      buildSessionContext: () => {
        const messages: AgentMessage[] = [];
        const seen = new Set<string>();
        let cursor = currentLeafId;
        while (cursor && !seen.has(cursor)) {
          seen.add(cursor);
          const entry = byId.get(cursor);
          if (!entry) {
            break;
          }
          if (entry.type === "message" && entry.message) {
            messages.push(entry.message);
          }
          cursor = entry.parentId ?? null;
        }
        messages.reverse();
        return { messages };
      },
    };
  }

  it("merges trailing orphaned users into the current prompt in order", () => {
    const sessionManager = createSessionManager(
      [
        {
          id: "assistant",
          type: "message",
          message: { role: "assistant", content: [{ type: "text", text: "seed assistant" }] },
        },
        {
          id: "u1",
          type: "message",
          parentId: "assistant",
          message: { role: "user", content: [{ type: "text", text: "first orphaned message" }] },
        },
        {
          id: "u2",
          type: "message",
          parentId: "u1",
          message: { role: "user", content: [{ type: "text", text: "second orphaned message" }] },
        },
      ],
      "u2",
    );

    const replaceMessages = vi.fn();
    const result = recoverOrphanedUserMessagesForPrompt({
      sessionManager,
      prompt: "hello",
      replaceMessages,
    });

    expect(result.recoveredCount).toBe(2);
    expect(result.mergedCount).toBe(2);
    expect(result.prompt).toContain("first orphaned message");
    expect(result.prompt).toContain("second orphaned message");
    expect(result.prompt.indexOf("first orphaned message")).toBeLessThan(
      result.prompt.indexOf("second orphaned message"),
    );
    expect(result.prompt.indexOf("second orphaned message")).toBeLessThan(
      result.prompt.indexOf("hello"),
    );
    expect(replaceMessages).toHaveBeenCalledTimes(1);
  });

  it("adds a placeholder for orphaned image-only user content", () => {
    const sessionManager = createSessionManager(
      [
        {
          id: "assistant",
          type: "message",
          message: { role: "assistant", content: [{ type: "text", text: "seed assistant" }] },
        },
        {
          id: "u1",
          type: "message",
          parentId: "assistant",
          message: {
            role: "user",
            content: [{ type: "image", data: "abc", mimeType: "image/png" }],
          },
        },
      ],
      "u1",
    );

    const replaceMessages = vi.fn();
    const result = recoverOrphanedUserMessagesForPrompt({
      sessionManager,
      prompt: "hello",
      replaceMessages,
    });

    expect(result.recoveredCount).toBe(1);
    expect(result.mergedCount).toBe(1);
    expect(result.prompt).toContain("[user attached an image]");
    expect(replaceMessages).toHaveBeenCalledTimes(1);
  });

  it("returns prompt unchanged when no orphaned user leaf exists", () => {
    const sessionManager = createSessionManager(
      [
        {
          id: "assistant",
          type: "message",
          message: { role: "assistant", content: [{ type: "text", text: "seed assistant" }] },
        },
      ],
      "assistant",
    );

    const replaceMessages = vi.fn();
    const result = recoverOrphanedUserMessagesForPrompt({
      sessionManager,
      prompt: "hello",
      replaceMessages,
    });

    expect(result).toEqual({
      prompt: "hello",
      recoveredCount: 0,
      mergedCount: 0,
    });
    expect(replaceMessages).not.toHaveBeenCalled();
  });
});
