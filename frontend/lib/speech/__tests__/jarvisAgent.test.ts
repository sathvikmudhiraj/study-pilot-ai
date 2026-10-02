import { describe, expect, it } from "vitest";
import {
  inferJarvisTask,
  inferJarvisTopic,
  matchJarvisFiles,
  resolveJarvisControlIntent,
} from "../jarvisAgent";

describe("Jarvis agent routing", () => {
  it("resolves control and contextual follow-up intents before generic Ask", () => {
    expect(resolveJarvisControlIntent("Wait, explain simpler.")).toEqual({ kind: "follow_up", action: "simplify" });
    expect(resolveJarvisControlIntent("Next")).toEqual({ kind: "follow_up", action: "next" });
    expect(resolveJarvisControlIntent("Generate an image for this concept")).toEqual({ kind: "generate_image" });
    expect(resolveJarvisControlIntent("Generate an image of deadlock prevention")).toEqual({
      kind: "generate_image",
      topic: "deadlock prevention",
    });
    expect(resolveJarvisControlIntent("Show me the sources")).toEqual({ kind: "show_source" });
    expect(resolveJarvisControlIntent("Wake up")).toEqual({ kind: "resume" });
    expect(resolveJarvisControlIntent("Save this result")).toEqual({ kind: "save_result" });
  });

  it("resolves natural file commands without selecting unrelated files", () => {
    const files = [
      { id: "module", file_name: "Module-3.docx" },
      { id: "cn", file_name: "Computer Networks.pdf" },
    ];
    expect(resolveJarvisControlIntent("Open Module 3")).toEqual({ kind: "select_file", query: "module 3" });
    expect(matchJarvisFiles(files, "Module 3")).toEqual([files[0]]);
    expect(matchJarvisFiles(files, "chemistry")).toEqual([]);
  });

  it("tracks task and topic independently", () => {
    expect(inferJarvisTask("Explain deadlocks from this file")).toBe("explain");
    expect(inferJarvisTopic("Explain deadlocks from this file")).toBe("deadlocks");
    expect(inferJarvisTask("Give me viva questions")).toBe("viva");
  });
});
