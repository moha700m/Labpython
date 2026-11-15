import Anthropic from "@anthropic-ai/sdk";
import type { ProjectFile, Diagnostic } from "@mcs/shared";
import { normalizeProjectPath } from "@mcs/shared";
import type { AppConfig } from "./config.ts";

/**
 * Arabic C++ assistant. The assistant NEVER writes to the project: it returns an
 * answer plus *proposed* file changes. The web client shows a diff and only the
 * user's explicit approval saves anything (through the normal file API).
 */
export type AssistantTask = "explain" | "fix" | "review" | "optimize" | "generate" | "tests" | "stacktrace" | "teach" | "chat";

export interface AssistantRequest {
  task: AssistantTask;
  message: string;
  files: ProjectFile[];
  activeFile?: string;
  selection?: string;
  diagnostics?: Diagnostic[];
  buildLog?: string;
}

export interface ProposedChange {
  path: string;
  action: "create" | "modify" | "delete";
  content: string;
  reasonAr: string;
}

export interface AssistantResponse {
  answerAr: string;
  changes: ProposedChange[];
  provider: string;
  model: string;
}

export interface AssistantProvider {
  readonly name: string;
  readonly model: string;
  available(): boolean;
  ask(req: AssistantRequest): Promise<AssistantResponse>;
}

const SYSTEM_PROMPT = `أنت "مساعد Muhammad C++ Studio"، خبير C++ يشرح بالعربية الفصحى المبسطة لمستخدمين من المبتدئين حتى المحترفين.
- اكتب الشرح بالعربية، واترك الكود وأسماء الدوال والرسائل التقنية بالإنجليزية.
- المستخدم يبني لويندوز عبر MinGW-w64 أو لينكس عبر GCC/Clang، والمعيار الافتراضي C++20.
- عند اقتراح تعديل ملفات ضع المحتوى الكامل الجديد لكل ملف في changes، ولا تقترح تعديلاً إلا عند الحاجة.
- لا تدّعِ أنك شغّلت الكود أو بنيته؛ أنت لا تملك القدرة على التنفيذ.
- مسارات الملفات نسبية لجذر المشروع.
- كن موجزاً ودقيقاً، واشرح السبب قبل الحل.`;

const TASK_HINTS: Record<AssistantTask, string> = {
  explain: "اشرح الكود المحدد أو الملف النشط خطوة بخطوة.",
  fix: "شخّص الأخطاء من مخرجات المترجم واقترح إصلاحاً كاملاً.",
  review: "راجع الكود: الأخطاء المحتملة، الأمان، الأسلوب، وأفضل الممارسات الحديثة.",
  optimize: "اقترح تحسينات أداء مع شرح التكلفة الزمنية والمكانية.",
  generate: "حوّل وصف المستخدم إلى مشروع C++ كامل قابل للبناء (ملفات جديدة في changes).",
  tests: "اقترح اختبارات وحدات بسيطة بدون مكتبات خارجية (assert) في ملف tests/*.cpp.",
  stacktrace: "اشرح Stack Trace أو رسالة الانهيار وحدد السبب المرجح.",
  teach: "علّم المفهوم خطوة بخطوة مع مثال صغير وتمرين.",
  chat: "أجب عن سؤال المستخدم.",
};

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answerAr", "changes"],
  properties: {
    answerAr: { type: "string" },
    changes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "action", "content", "reasonAr"],
        properties: {
          path: { type: "string" },
          action: { type: "string", enum: ["create", "modify", "delete"] },
          content: { type: "string" },
          reasonAr: { type: "string" },
        },
      },
    },
  },
} as const;

export function buildUserPrompt(req: AssistantRequest): string {
  const parts: string[] = [`المهمة: ${TASK_HINTS[req.task]}`];
  const textFiles = req.files.filter((f) => f.encoding === "utf8");
  let budget = 400_000; // characters of project context
  const ordered = [...textFiles].sort((a, b) => (a.path === req.activeFile ? -1 : b.path === req.activeFile ? 1 : 0));
  parts.push("<project>");
  for (const f of ordered) {
    if (f.content.length > budget) {
      parts.push(`<file path="${f.path}" omitted="too-large-for-context"/>`);
      continue;
    }
    budget -= f.content.length;
    parts.push(`<file path="${f.path}">\n${f.content}\n</file>`);
  }
  parts.push("</project>");
  if (req.activeFile) parts.push(`الملف النشط: ${req.activeFile}`);
  if (req.selection) parts.push(`<selection>\n${req.selection.slice(0, 20_000)}\n</selection>`);
  if (req.diagnostics?.length) {
    parts.push("<diagnostics>");
    for (const d of req.diagnostics.slice(0, 50)) parts.push(`${d.file}:${d.line}:${d.column}: ${d.severity}: ${d.message}`);
    parts.push("</diagnostics>");
  }
  if (req.buildLog) parts.push(`<build_log>\n${req.buildLog.slice(-20_000)}\n</build_log>`);
  parts.push(`<user_message>\n${req.message.slice(0, 10_000)}\n</user_message>`);
  return parts.join("\n");
}

export function sanitizeChanges(changes: ProposedChange[]): ProposedChange[] {
  const out: ProposedChange[] = [];
  for (const c of changes.slice(0, 30)) {
    try {
      out.push({ ...c, path: normalizeProjectPath(c.path), content: c.action === "delete" ? "" : c.content });
    } catch {
      // Drop any proposal pointing outside the project.
    }
  }
  return out;
}

export class AnthropicProvider implements AssistantProvider {
  readonly name = "anthropic";
  private client: Anthropic | null;
  constructor(readonly model: string, apiKey: string | null) {
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
  }
  available() {
    return this.client !== null;
  }
  async ask(req: AssistantRequest): Promise<AssistantResponse> {
    if (!this.client) throw new Error("AI provider not configured");
    const stream = this.client.beta.messages.stream({
      model: this.model,
      max_tokens: 64000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: { type: "json_schema", schema: RESPONSE_SCHEMA } },
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: buildUserPrompt(req) }],
    });
    const msg = (await stream.finalMessage()) as unknown as {
      stop_reason: string | null;
      content: { type: string; text?: string }[];
    };
    if (msg.stop_reason === "refusal") {
      return { answerAr: "تعذّر على المساعد الإجابة عن هذا الطلب.", changes: [], provider: this.name, model: this.model };
    }
    const text = msg.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
    let parsed: { answerAr: string; changes: ProposedChange[] };
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { answerAr: text || "لم يصل رد صالح من المساعد.", changes: [] };
    }
    return { answerAr: parsed.answerAr, changes: sanitizeChanges(parsed.changes ?? []), provider: this.name, model: this.model };
  }
}

/** Used when no provider is configured: the UI shows the assistant as unavailable. */
export class NoProvider implements AssistantProvider {
  readonly name = "none";
  readonly model = "";
  available() {
    return false;
  }
  async ask(): Promise<AssistantResponse> {
    throw new Error("AI provider not configured");
  }
}

export function createProvider(config: AppConfig["ai"]): AssistantProvider {
  if (config.provider === "anthropic") return new AnthropicProvider(config.model, config.apiKey);
  return new NoProvider();
}
