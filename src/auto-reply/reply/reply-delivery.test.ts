import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createBlockReplyContentKey } from "./block-reply-pipeline.js";
import {
  createBlockReplyDeliveryHandler,
  normalizeReplyPayloadDirectives,
} from "./reply-delivery.js";
import type { TypingSignaler } from "./typing-mode.js";

type BlockReplyPipelineLike = NonNullable<
  Parameters<typeof createBlockReplyDeliveryHandler>[0]["blockReplyPipeline"]
>;

describe("createBlockReplyDeliveryHandler", () => {
  it("sends media-bearing block replies even when block streaming is disabled", async () => {
    const onBlockReply = vi.fn(async () => {});
    const normalizeStreamingText = vi.fn((payload: { text?: string }) => ({
      text: payload.text,
      skip: false,
    }));
    const directlySentBlockKeys = new Set<string>();
    const typingSignals = {
      signalTextDelta: vi.fn(async () => {}),
    } as unknown as TypingSignaler;

    const handler = createBlockReplyDeliveryHandler({
      onBlockReply,
      normalizeStreamingText,
      applyReplyToMode: (payload) => payload,
      typingSignals,
      blockStreamingEnabled: false,
      blockReplyPipeline: null,
      directlySentBlockKeys,
    });

    await handler({
      text: "here's the vibe",
      mediaUrls: ["/tmp/generated.png"],
      replyToCurrent: true,
    });

    expect(onBlockReply).toHaveBeenCalledWith({
      text: undefined,
      mediaUrl: "/tmp/generated.png",
      mediaUrls: ["/tmp/generated.png"],
      replyToCurrent: true,
      replyToId: undefined,
      replyToTag: undefined,
      audioAsVoice: false,
    });
    expect(directlySentBlockKeys).toEqual(
      new Set([
        createBlockReplyContentKey({
          text: "here's the vibe",
          mediaUrls: ["/tmp/generated.png"],
          replyToCurrent: true,
        }),
      ]),
    );
    expect(typingSignals.signalTextDelta).toHaveBeenCalledWith("here's the vibe");
  });

  it("keeps text-only block replies buffered when block streaming is disabled", async () => {
    const onBlockReply = vi.fn(async () => {});

    const handler = createBlockReplyDeliveryHandler({
      onBlockReply,
      normalizeStreamingText: (payload) => ({ text: payload.text, skip: false }),
      applyReplyToMode: (payload) => payload,
      typingSignals: {
        signalTextDelta: vi.fn(async () => {}),
      } as unknown as TypingSignaler,
      blockStreamingEnabled: false,
      blockReplyPipeline: null,
      directlySentBlockKeys: new Set(),
    });

    await handler({ text: "text only" });

    expect(onBlockReply).not.toHaveBeenCalled();
  });

  it("trims leading whitespace in block-streamed replies", async () => {
    const blockReplyPipeline = {
      enqueue: vi.fn(),
    } as unknown as BlockReplyPipelineLike;

    const handler = createBlockReplyDeliveryHandler({
      onBlockReply: vi.fn(async () => {}),
      normalizeStreamingText: (payload) => ({ text: payload.text, skip: false }),
      applyReplyToMode: (payload) => payload,
      typingSignals: {
        signalTextDelta: vi.fn(async () => {}),
      } as unknown as TypingSignaler,
      blockStreamingEnabled: true,
      blockReplyPipeline,
      directlySentBlockKeys: new Set(),
    });

    await handler({ text: "\n\n  Hello from stream" });

    expect(blockReplyPipeline.enqueue).toHaveBeenCalledWith({
      text: "Hello from stream",
      mediaUrl: undefined,
      replyToId: undefined,
      replyToCurrent: undefined,
      replyToTag: undefined,
      audioAsVoice: false,
      mediaUrls: undefined,
    });
  });

  it("parses media directives in block replies before path normalization", () => {
    const normalized = normalizeReplyPayloadDirectives({
      payload: { text: "Result\nMEDIA: ./image.png" },
      trimLeadingWhitespace: true,
      parseMode: "auto",
    });

    expect(normalized.payload).toMatchObject({
      text: "Result",
      mediaUrl: "./image.png",
      mediaUrls: ["./image.png"],
    });
  });

  it("passes normalized media block replies through media path normalization", async () => {
    const blockReplyPipeline = {
      enqueue: vi.fn(),
    } as unknown as BlockReplyPipelineLike;
    const absPath = path.join("/tmp/home", "openclaw", "image.png");

    const handler = createBlockReplyDeliveryHandler({
      onBlockReply: vi.fn(async () => {}),
      normalizeStreamingText: (payload) => ({ text: payload.text, skip: false }),
      applyReplyToMode: (payload) => payload,
      normalizeMediaPaths: async (payload) => ({
        ...payload,
        mediaUrl: absPath,
        mediaUrls: [absPath],
      }),
      typingSignals: {
        signalTextDelta: vi.fn(async () => {}),
      } as unknown as TypingSignaler,
      blockStreamingEnabled: true,
      blockReplyPipeline,
      directlySentBlockKeys: new Set(),
    });

    await handler({ text: "Result\nMEDIA: ./image.png" });

    expect(blockReplyPipeline.enqueue).toHaveBeenCalledWith({
      text: "Result",
      mediaUrl: absPath,
      mediaUrls: [absPath],
      replyToId: undefined,
      replyToCurrent: false,
      replyToTag: false,
      audioAsVoice: false,
    });
  });

  it("passes abort context to direct block sends", async () => {
    const onBlockReply = vi.fn(async () => {});

    const handler = createBlockReplyDeliveryHandler({
      onBlockReply,
      normalizeStreamingText: (payload) => ({ text: payload.text, skip: false }),
      applyReplyToMode: (payload) => payload,
      typingSignals: {
        signalTextDelta: vi.fn(async () => {}),
      } as unknown as TypingSignaler,
      blockStreamingEnabled: true,
      blockReplyPipeline: null,
      directlySentBlockKeys: new Set(),
    });

    await handler({ text: "stream me" });

    expect(onBlockReply).toHaveBeenCalledWith(
      expect.objectContaining({ text: "stream me" }),
      expect.objectContaining({ abortSignal: expect.any(AbortSignal) }),
    );
  });

  it("aborts direct block sends when delivery becomes suppressed mid-send", async () => {
    let suppressed = false;
    let observedAbort = false;
    const onBlockReply = vi.fn(
      async (_payload: { text?: string }, context?: { abortSignal?: AbortSignal }) => {
        const signal = context?.abortSignal;
        signal?.addEventListener(
          "abort",
          () => {
            observedAbort = true;
          },
          { once: true },
        );
        await new Promise<void>((resolve) => setTimeout(resolve, 40));
      },
    );

    const handler = createBlockReplyDeliveryHandler({
      onBlockReply,
      normalizeStreamingText: (payload) => ({ text: payload.text, skip: false }),
      applyReplyToMode: (payload) => payload,
      typingSignals: {
        signalTextDelta: vi.fn(async () => {}),
      } as unknown as TypingSignaler,
      blockStreamingEnabled: true,
      blockReplyPipeline: null,
      directlySentBlockKeys: new Set(),
      shouldSuppressDelivery: () => suppressed,
    });

    const delivery = handler({ text: "slow send" });
    await new Promise((resolve) => setTimeout(resolve, 15));
    suppressed = true;
    await delivery;

    expect(onBlockReply).toHaveBeenCalledTimes(1);
    expect(observedAbort).toBe(true);
  });
});
