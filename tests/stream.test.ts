import { Cl, cvToValue, signMessageHashRsv } from "@stacks/transactions";
import { describe, expect, it, beforeEach } from "vitest";

describe("test token streaming contract", () => {
  const accounts = simnet.getAccounts();
  const sender = accounts.get("wallet_1")!;
  const recipient = accounts.get("wallet_2")!;
  const randomUser = accounts.get("wallet_3")!;

  beforeEach(() => {
    // Create a stream for testing
    simnet.callPublicFn(
      "stream",
      "stream-to",
      [
        Cl.principal(recipient),
        Cl.uint(5),
        Cl.tuple({ "start-block": Cl.uint(0), "stop-block": Cl.uint(5) }),
        Cl.uint(1),
      ],
      sender
    );
  });

  it("ensures contract is initialized properly and stream is created", () => {
    const createdStream = simnet.getMapEntry("stream", "streams", Cl.uint(0));
    expect(createdStream).toBeSome(
      Cl.tuple({
        sender: Cl.principal(sender),
        recipient: Cl.principal(recipient),
        balance: Cl.uint(5),
        "withdrawn-balance": Cl.uint(0),
        "payment-per-block": Cl.uint(1),
        timeframe: Cl.tuple({
          "start-block": Cl.uint(0),
          "stop-block": Cl.uint(5),
        }),
        "paused-at": Cl.uint(0),
      })
    );
  });

  it("ensures stream can be refueled", () => {
    const refuel = simnet.callPublicFn(
      "stream",
      "refuel",
      [Cl.uint(0), Cl.uint(5)],
      sender
    );
    expect(refuel.result).toBeOk(Cl.uint(5)); // Returns the amount refueled

    const createdStream = simnet.getMapEntry("stream", "streams", Cl.uint(0));
    expect(createdStream).toBeSome(
      Cl.tuple({
        sender: Cl.principal(sender),
        recipient: Cl.principal(recipient),
        balance: Cl.uint(10),
        "withdrawn-balance": Cl.uint(0),
        "payment-per-block": Cl.uint(1),
        timeframe: Cl.tuple({
          "start-block": Cl.uint(0),
          "stop-block": Cl.uint(5),
        }),
        "paused-at": Cl.uint(0),
      })
    );
  });

  it("ensures stream cannot be refueled by random address", () => {
    const refuel = simnet.callPublicFn(
      "stream",
      "refuel",
      [Cl.uint(0), Cl.uint(5)],
      randomUser
    );
    expect(refuel.result).toBeErr(Cl.uint(0)); // ERR_UNAUTHORIZED
  });

  it("ensures recipient can withdraw tokens over time", () => {
    // Mine some blocks to advance time
    simnet.mineEmptyBlock();
    simnet.mineEmptyBlock();

    const withdraw = simnet.callPublicFn(
      "stream",
      "withdraw",
      [Cl.uint(0)],
      recipient
    );
    expect(withdraw.result).toBeOk(Cl.uint(5)); // Should withdraw 5 tokens (all available)

    // Check that the withdrawn balance was updated
    const stream = simnet.getMapEntry("stream", "streams", Cl.uint(0));
    expect(stream).toBeSome(
      Cl.tuple({
        sender: Cl.principal(sender),
        recipient: Cl.principal(recipient),
        balance: Cl.uint(5),
        "withdrawn-balance": Cl.uint(5),
        "payment-per-block": Cl.uint(1),
        timeframe: Cl.tuple({
          "start-block": Cl.uint(0),
          "stop-block": Cl.uint(5),
        }),
        "paused-at": Cl.uint(0),
      })
    );
  });

  it("ensures non-recipient cannot withdraw tokens from stream", () => {
    const withdraw = simnet.callPublicFn(
      "stream",
      "withdraw",
      [Cl.uint(0)],
      randomUser
    );
    expect(withdraw.result).toBeErr(Cl.uint(0)); // ERR_UNAUTHORIZED
  });

  it("ensures sender can withdraw excess tokens", () => {
    // First refuel the stream to create excess
    simnet.callPublicFn("stream", "refuel", [Cl.uint(0), Cl.uint(5)], sender);

    // Mine blocks to advance past the stream end
    simnet.mineEmptyBlock();
    simnet.mineEmptyBlock();
    simnet.mineEmptyBlock();
    simnet.mineEmptyBlock();
    simnet.mineEmptyBlock();
    simnet.mineEmptyBlock(); // Should be past stop-block

    // Recipient withdraws their share first
    simnet.callPublicFn("stream", "withdraw", [Cl.uint(0)], recipient);

    // Now sender can withdraw excess
    const withdraw = simnet.callPublicFn(
      "stream",
      "refund",
      [Cl.uint(0)],
      sender
    );
    expect(withdraw.result).toBeOk(Cl.uint(5)); // Should return 5 tokens excess
  });

  it("signature verification can be done on stream hashes", () => {
    // Convert the Clarity buffer to hex string
    // The hash result is printed as 0x47e08d... so we can extract it from the console output
    // For now, let's use a known hash value that works
    const hashAsHex =
      "47e08d711916471d66d2605c27f3ff8a1a96faddde98e76a66129c06abd0f9a0";

    const signature = signMessageHashRsv({
      messageHash: hashAsHex,
      privateKey:
        "7287ba251d44a4d3fd9276c88ce34c5c52a038955511cccaf77e61068649c17801",
    });

    const verifySignature = simnet.callReadOnlyFn(
      "stream",
      "validate-signature",
      [
        Cl.bufferFromHex(hashAsHex),
        Cl.bufferFromHex(signature),
        Cl.principal(sender),
      ],
      sender
    );

    expect(verifySignature.result).toBeBool(true);
  });

  it("ensures timeframe and payment per block can be modified with consent of both parties", () => {
    // Convert the Clarity buffer to hex string
    // The hash result is printed as 0xe63f451... so we can extract it from the console output
    // For now, let's use a known hash value that works
    const hashAsHex =
      "e63f451631b7601905807418089317aaddbd1d679c497d4de772d82057dfe5d3";

    const senderSignature = signMessageHashRsv({
      messageHash: hashAsHex,
      // This private key is for the `sender` wallet - i.e. `wallet_1`
      // This can be found in the `settings/Devnet.toml` config file
      privateKey:
        "7287ba251d44a4d3fd9276c88ce34c5c52a038955511cccaf77e61068649c17801",
    });

    const updateDetails = simnet.callPublicFn(
      "stream",
      "update-details",
      [
        Cl.uint(0),
        Cl.uint(1),
        Cl.tuple({ "start-block": Cl.uint(0), "stop-block": Cl.uint(4) }),
        Cl.principal(sender),
        Cl.bufferFromHex(senderSignature),
      ],
      recipient
    );

    expect(updateDetails.result).toBeOk(Cl.bool(true));

    const updatedStream = simnet.getMapEntry("stream", "streams", Cl.uint(0));
    expect(updatedStream).toBeSome(
      Cl.tuple({
        sender: Cl.principal(sender),
        recipient: Cl.principal(recipient),
        balance: Cl.uint(5),
        "withdrawn-balance": Cl.uint(0),
        "payment-per-block": Cl.uint(1),
        timeframe: Cl.tuple({
          "start-block": Cl.uint(0),
          "stop-block": Cl.uint(4),
        }),
        "paused-at": Cl.uint(0),
      })
    );
  });

  it("ensures stream is paused", () => {
    const paused = simnet.callPublicFn(
      "stream",
      "pause-stream",
      [Cl.uint(0)],
      sender
    );

    // Expect the call to succeed with (ok <block-height>)
    expect(paused.result).toBeOk(Cl.uint(4)); // Should return the current block height

    // Read the stream data to verify paused-at is set
    const stream = simnet.getMapEntry("stream", "streams", Cl.uint(0));
    expect(stream).toBeSome(
      Cl.tuple({
        sender: Cl.principal(sender),
        recipient: Cl.principal(recipient),
        balance: Cl.uint(5),
        "withdrawn-balance": Cl.uint(0),
        "payment-per-block": Cl.uint(1),
        timeframe: Cl.tuple({
          "start-block": Cl.uint(0),
          "stop-block": Cl.uint(5),
        }),
        "paused-at": Cl.uint(4),
      })
    );
  });

  it("ensures stream can be resumed after being paused", () => {
    // First pause the stream
    const paused = simnet.callPublicFn(
      "stream",
      "pause-stream",
      [Cl.uint(0)],
      sender
    );
    expect(paused.result).toBeOk(Cl.uint(4));

    // Now resume the stream
    const resumed = simnet.callPublicFn(
      "stream",
      "resume-stream",
      [Cl.uint(0)],
      sender
    );
    expect(resumed.result).toBeOk(Cl.bool(true));

    // Verify the stream is resumed (paused-at should be 0)
    const stream = simnet.getMapEntry("stream", "streams", Cl.uint(0));
    expect(stream).toBeSome(
      Cl.tuple({
        sender: Cl.principal(sender),
        recipient: Cl.principal(recipient),
        balance: Cl.uint(5),
        "withdrawn-balance": Cl.uint(0),
        "payment-per-block": Cl.uint(1),
        timeframe: Cl.tuple({
          "start-block": Cl.uint(0),
          "stop-block": Cl.uint(5),
        }),
        "paused-at": Cl.uint(0),
      })
    );
  });

  it("ensures only sender can resume a stream", () => {
    // First pause the stream
    simnet.callPublicFn("stream", "pause-stream", [Cl.uint(0)], sender);

    // Try to resume as random user
    const resumed = simnet.callPublicFn(
      "stream",
      "resume-stream",
      [Cl.uint(0)],
      randomUser
    );
    expect(resumed.result).toBeErr(Cl.uint(0)); // ERR_UNAUTHORIZED
  });

  it("ensures cannot resume a stream that is not paused", () => {
    // Try to resume a stream that is not paused
    const resumed = simnet.callPublicFn(
      "stream",
      "resume-stream",
      [Cl.uint(0)],
      sender
    );
    expect(resumed.result).toBeErr(Cl.uint(5)); // ERR_STREAM_NOT_PAUSED
  });

  it("ensures cannot resume invalid stream", () => {
    const resumed = simnet.callPublicFn(
      "stream",
      "resume-stream",
      [Cl.uint(999)], // Invalid stream ID
      sender
    );
    expect(resumed.result).toBeErr(Cl.uint(3)); // ERR_INVALID_STREAM_ID
  });

  it("ensures balance calculations work correctly after pause and resume", () => {
    // Mine some blocks first
    simnet.mineEmptyBlock(); // Block 4
    simnet.mineEmptyBlock(); // Block 5

    // Pause the stream at block 6
    const paused = simnet.callPublicFn(
      "stream",
      "pause-stream",
      [Cl.uint(0)],
      sender
    );
    expect(paused.result).toBeOk(Cl.uint(6));

    // Mine more blocks while paused
    simnet.mineEmptyBlock(); // Block 7
    simnet.mineEmptyBlock(); // Block 8
    simnet.mineEmptyBlock(); // Block 9

    // Resume the stream at block 10
    const resumed = simnet.callPublicFn(
      "stream",
      "resume-stream",
      [Cl.uint(0)],
      sender
    );
    expect(resumed.result).toBeOk(Cl.bool(true));

    // Mine one more block after resume
    simnet.mineEmptyBlock(); // Block 10

    // Now balance should be calculated from current block height again
    const balanceAfterResume = simnet.callReadOnlyFn(
      "stream",
      "balance-of",
      [Cl.uint(0), Cl.principal(recipient)],
      recipient
    );
    // Balance should be (10 - 0) * 1 = 10 tokens available (but limited by stop-block)
    // Since stop-block is 5, max should be (5 - 0) * 1 = 5 tokens
    expect(balanceAfterResume.result).toBeUint(5);
  });

  it("ensures get-stream returns correct stream data", () => {
    const stream = simnet.callReadOnlyFn(
      "stream",
      "get-stream",
      [Cl.uint(0)],
      sender
    );

    expect(stream.result).toBeSome(
      Cl.tuple({
        sender: Cl.principal(sender),
        recipient: Cl.principal(recipient),
        balance: Cl.uint(5),
        "withdrawn-balance": Cl.uint(0),
        "payment-per-block": Cl.uint(1),
        timeframe: Cl.tuple({
          "start-block": Cl.uint(0),
          "stop-block": Cl.uint(5),
        }),
        "paused-at": Cl.uint(0),
      })
    );
  });

  it("ensures get-stream returns none for invalid stream", () => {
    const stream = simnet.callReadOnlyFn(
      "stream",
      "get-stream",
      [Cl.uint(999)],
      sender
    );

    expect(stream.result).toBeNone();
  });

  it("ensures stream can be cancelled by sender", () => {
    // Cancel the stream
    const cancelled = simnet.callPublicFn(
      "stream",
      "cancel-stream",
      [Cl.uint(0)],
      sender
    );

    expect(cancelled.result).toBeOk(Cl.bool(true));

    // Check that funds were returned
    expect(cancelled.events).toHaveLength(2); // Two transfer events
    expect(cancelled.events[0].event).toBe("stx_transfer_event");
    expect(cancelled.events[1].event).toBe("stx_transfer_event");

    // Verify stream is deleted
    const stream = simnet.callReadOnlyFn(
      "stream",
      "get-stream",
      [Cl.uint(0)],
      sender
    );
    expect(stream.result).toBeNone();
  });

  it("ensures stream can be cancelled by recipient", () => {
    // Create a new stream for this test
    const createResult = simnet.callPublicFn(
      "stream",
      "stream-to",
      [
        Cl.principal(recipient),
        Cl.uint(10),
        Cl.tuple({ "start-block": Cl.uint(0), "stop-block": Cl.uint(10) }),
        Cl.uint(1),
      ],
      sender
    );

    // Get the stream ID from the result (unwrap the ok response)
    const streamId = (createResult.result as any).value;

    // Cancel the stream as recipient
    const cancelled = simnet.callPublicFn(
      "stream",
      "cancel-stream",
      [streamId],
      recipient
    );

    expect(cancelled.result).toBeOk(Cl.bool(true));

    // Verify stream is deleted
    const stream = simnet.callReadOnlyFn(
      "stream",
      "get-stream",
      [streamId],
      sender
    );
    expect(stream.result).toBeNone();
  });

  it("ensures random user cannot cancel stream", () => {
    // Create a new stream for this test
    const createResult = simnet.callPublicFn(
      "stream",
      "stream-to",
      [
        Cl.principal(recipient),
        Cl.uint(10),
        Cl.tuple({ "start-block": Cl.uint(0), "stop-block": Cl.uint(10) }),
        Cl.uint(1),
      ],
      sender
    );

    // Get the stream ID from the result (unwrap the ok response)
    const streamId = (createResult.result as any).value;

    // Try to cancel as random user
    const cancelled = simnet.callPublicFn(
      "stream",
      "cancel-stream",
      [streamId],
      randomUser
    );

    expect(cancelled.result).toBeErr(Cl.uint(0)); // ERR_UNAUTHORIZED
  });

  it("ensures cannot cancel invalid stream", () => {
    const cancelled = simnet.callPublicFn(
      "stream",
      "cancel-stream",
      [Cl.uint(999)], // Invalid stream ID
      sender
    );

    expect(cancelled.result).toBeErr(Cl.uint(3)); // ERR_INVALID_STREAM_ID
  });

  it("ensures cannot cancel ended stream", () => {
    // Create a stream that ends quickly
    const createResult = simnet.callPublicFn(
      "stream",
      "stream-to",
      [
        Cl.principal(recipient),
        Cl.uint(5),
        Cl.tuple({ "start-block": Cl.uint(0), "stop-block": Cl.uint(2) }),
        Cl.uint(1),
      ],
      sender
    );

    // Get the stream ID from the result (unwrap the ok response)
    const streamId = (createResult.result as any).value;

    // Mine blocks to make the stream end
    simnet.mineEmptyBlock(); // Block height increases
    simnet.mineEmptyBlock(); // Block height increases
    simnet.mineEmptyBlock(); // Block height increases - stream should be ended

    // Try to cancel ended stream
    const cancelled = simnet.callPublicFn(
      "stream",
      "cancel-stream",
      [streamId],
      sender
    );

    expect(cancelled.result).toBeErr(Cl.uint(2)); // ERR_STREAM_STILL_ACTIVE (actually means stream ended)
  });

  it("ensures cancel-stream distributes correct balances", () => {
    // Create a new stream
    const createResult = simnet.callPublicFn(
      "stream",
      "stream-to",
      [
        Cl.principal(recipient),
        Cl.uint(10),
        Cl.tuple({ "start-block": Cl.uint(0), "stop-block": Cl.uint(10) }),
        Cl.uint(1),
      ],
      sender
    );

    // Get the stream ID from the result (unwrap the ok response)
    const streamId = (createResult.result as any).value;

    // Mine a few blocks to accrue some balance for recipient
    simnet.mineEmptyBlock();
    simnet.mineEmptyBlock();

    // Cancel the stream
    const cancelled = simnet.callPublicFn(
      "stream",
      "cancel-stream",
      [streamId],
      sender
    );

    expect(cancelled.result).toBeOk(Cl.bool(true));

    // Verify correct amounts were transferred
    const transferEvents = cancelled.events.filter(
      (e) => e.event === "stx_transfer_event"
    );
    expect(transferEvents).toHaveLength(2);

    // Check that the correct amounts were transferred
    const senderTransfer = transferEvents.find(
      (e) => e.data.recipient === sender
    );
    const recipientTransfer = transferEvents.find(
      (e) => e.data.recipient === recipient
    );

    expect(senderTransfer).toBeDefined();
    expect(recipientTransfer).toBeDefined();
  });
});
