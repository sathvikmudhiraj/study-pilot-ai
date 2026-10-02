import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { analyzeLocalSources, buildLocalChatAnswer, buildLocalQuiz, buildLocalRevisionPlan, readLocalDocxParagraphs } from "../localStudyFallback";

const material = `Cloud Computing
Cloud computing is the delivery of computing services over the internet.
Public cloud is infrastructure offered to many users over the internet.
Private cloud is infrastructure dedicated to one organization.
Hybrid cloud is a combination of public cloud and private cloud.
Virtualization
Virtualization is the creation of virtual versions of computing resources.
Hypervisor is software that creates and manages virtual machines.
Scalability
Scalability is the ability to increase resources as demand grows.
Elasticity is the ability to adjust resources as demand changes.
Security
Encryption is the process of encoding data to protect information.
Authentication is the process of verifying a user's identity.
Availability is the ability of a service to remain accessible.
For example, a cloud service can add virtual machines when demand increases.`;

const source = { id: "file-1:chunk-1", label: "Module-3.docx", text: material, citation: { id: "file-1:chunk-1", source_id: "file-1", source_type: "file" as const, source_name: "Module-3.docx", locator_type: "chunk" as const, locator_start: 1 } };

describe("local source-grounded fallback", () => {
  it("recovers DOCX paragraph boundaries without changing saved extraction", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", `<w:document><w:body><w:p><w:r><w:t>Set Operators</w:t></w:r></w:p><w:p><w:r><w:t>UNION combines records from two tables.</w:t></w:r></w:p></w:body></w:document>`);
    const text = await readLocalDocxParagraphs(await zip.generateAsync({ type: "nodebuffer" }));
    expect(text).toBe("Set Operators\nUNION combines records from two tables.");
  });
  it("extracts headings, definitions and examples without adding source facts", () => {
    const facts = analyzeLocalSources([source]);
    expect(facts.length).toBeGreaterThan(8);
    expect(facts.some((fact) => fact.kind === "definition" && fact.topic === "Virtualization")).toBe(true);
    expect(facts.some((fact) => fact.kind === "example")).toBe(true);
    expect(facts.every((fact) => material.includes(fact.text))).toBe(true);
  });

  it("advances to a distinct second batch and preserves citations", () => {
    const first = buildLocalChatAnswer({ question: "Give important notes", sources: [source], count: 4 });
    const second = buildLocalChatAnswer({ question: "Give important notes", sources: [source], count: 4, excludedIds: first.fallback_item_ids });
    expect(first.fallback_item_ids).toHaveLength(4);
    expect(second.fallback_item_ids).toHaveLength(4);
    expect(second.fallback_item_ids.every((id) => !first.fallback_item_ids.includes(id))).toBe(true);
    expect(first.source_citations[0]?.source_name).toBe("Module-3.docx");
  });

  it("creates source-only viva answers and Telugu framing", () => {
    const viva = buildLocalChatAnswer({ question: "Give viva questions", sources: [source] });
    expect(viva.step_by_step[0]).toMatch(/Short answer:/);
    const telugu = buildLocalChatAnswer({ question: "Give important notes", sources: [source], language: "te" });
    expect(telugu.short_answer).toMatch(/[\u0c00-\u0c7f]/);
    expect(telugu.step_by_step[0]).toContain(source.citation.id);
  });

  it("builds a quiz with only source concepts as distractors", () => {
    const quiz = buildLocalQuiz(material, { count: 8, questionTypes: ["mcq", "short"] });
    expect(quiz.questions).toHaveLength(8);
    expect(quiz.questions.some((item) => item.type === "mcq")).toBe(true);
    for (const question of quiz.questions) {
      expect(material.includes(question.explanation)).toBe(true);
      if (question.type === "mcq") expect(question.options.every((option) => material.includes(option))).toBe(true);
      if (question.type === "mcq") expect(question.question).not.toMatch(/description:\s*\?/);
    }
  });

  it("never exposes internal context labels as quiz topics", () => {
    const quiz = buildLocalQuiz(`${material}\nSAVED SUMMARY CONTEXT:\nCovered topics:\nCloud security is the protection of cloud-hosted data.`, {
      count: 8,
      questionTypes: ["mcq", "short"],
    });
    const visible = quiz.questions.flatMap((question) => [question.topic, question.question, question.explanation]).join("\n");
    expect(visible).not.toMatch(/SAVED SUMMARY CONTEXT|RETRIEVED CONTEXT|PAGE CONTEXT|\bCHUNK\b/i);
  });

  it("builds seven dated sessions from the selected file", () => {
    const plan = buildLocalRevisionPlan({ files: [{ file_name: "Module-3.docx", content_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", extracted_text: material }], notes: [], summaries: [], quizzes: [], quiz_analytics: { attempt_count: 0, strong_topics: [], weak_topics: ["Virtualization", "Unrelated topic"], last_quiz_score: null } }, new Date("2026-09-24T00:00:00Z"));
    expect(plan.daily_plan).toHaveLength(7);
    expect(plan.starts_on).toBe("2026-09-24");
    expect(plan.plan.weak_topics).toContain("Virtualization");
    expect(plan.plan.weak_topics).not.toContain("Unrelated topic");
    expect(plan.daily_plan.flatMap((day) => day.tasks).some((task) => task.includes("Virtualization"))).toBe(true);
  });
});
