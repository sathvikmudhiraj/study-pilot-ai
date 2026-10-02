import { describe, expect, it } from "vitest";
import { sanitizeStudyStatePatch } from "../studyState";

describe("conversation study state", () => {
  it("keeps bounded agent state fields", () => {
    const state = sanitizeStudyStatePatch({
      active_topic: "Deadlocks",
      active_mode: "jarvis",
      detected_language: "te",
      current_artifact_id: "image-1",
      generated_asset_ids: ["image-1", "image-1", "diagram-2"],
      unfinished_task: { kind: "quiz", question: 3 },
    });
    expect(state).toMatchObject({
      active_topic: "Deadlocks",
      active_mode: "jarvis",
      detected_language: "te",
      current_artifact_id: "image-1",
      generated_asset_ids: ["image-1", "diagram-2"],
      unfinished_task: { kind: "quiz", question: 3 },
    });
  });

  it("rejects invalid nested state instead of storing arbitrary payloads", () => {
    expect(sanitizeStudyStatePatch({ unfinished_task: "not-an-object" })).toBeNull();
    expect(sanitizeStudyStatePatch({ generated_asset_ids: "not-an-array" })).toBeNull();
  });
});
