import { describe, expect, it } from "vitest";
import { GroundingReceiptTracker } from "./index.js";

describe("expression grounding", () => {
  it("tracks 4-stage grounding truth and recovers exact unsaid_remainder across silenced + done dual boundaries", () => {
    const tracker = new GroundingReceiptTracker();
    tracker.recordGenerated({
      intent_id: "int_stream_1",
      correlation_event_id: "evt_10",
      chunk_seq: 0,
      is_final: false,
      action_type: "speak",
      fallback_text: "第一段话已经说完，",
      extensions: {}
    });
    tracker.recordGenerated({
      intent_id: "int_stream_1",
      correlation_event_id: "evt_10",
      chunk_seq: 1,
      is_final: true,
      action_type: "speak",
      fallback_text: "第二段话说到一半被打断了",
      extensions: {}
    });
    expect(tracker.stage("int_stream_1", 0)).toBe("generated_unpresented");

    tracker.receive({
      intent_id: "int_stream_1",
      chunk_seq: 0,
      status: "completed",
      spoken_char_offset: 9
    });
    expect(tracker.stage("int_stream_1", 0)).toBe("physically_presented");
    expect(tracker.acknowledgeInterlocutor("int_stream_1", 0, "evt_user_reply_11")).toBe(true);
    expect(tracker.stage("int_stream_1", 0)).toBe("interlocutor_grounded");

    // Boundary 1: silenced freezes spoken offset at 4 chars ("第二段话"), does not settle yet
    expect(
      tracker.receive({
        intent_id: "int_stream_1",
        chunk_seq: 1,
        status: "playing",
        interruption_boundary: "silenced",
        spoken_char_offset: 4,
        interrupted_by_event_id: "evt_barge_in"
      })
    ).toBeUndefined();

    // Late in-flight progress after silenced must NOT advance presented offset past 4
    const settled = tracker.receive({
      intent_id: "int_stream_1",
      chunk_seq: 1,
      status: "interrupted",
      interruption_boundary: "done",
      spoken_char_offset: 9
    });
    expect(settled).toEqual({
      intent_id: "int_stream_1",
      chunk_seq: 1,
      spoken_char_offset: 4,
      unsaid_remainder: "说到一半被打断了",
      interrupted_by_event_id: "evt_barge_in"
    });
  });
});
