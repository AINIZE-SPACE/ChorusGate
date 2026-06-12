// ============================================================
// CodexEventParser — 解析 codex exec --json JSONL
//
// 基于 M0 实测 fixture（Codex CLI v0.139.0）:
//   tests/fixtures/codex-hello.jsonl
//   tests/fixtures/codex-resume.jsonl
//
// JSONL 格式:
//   {"type":"thread.started","thread_id":"019ebaf3-..."}
//   {"type":"turn.started"}
//   {"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"Hello!"}}
//   {"type":"turn.completed","usage":{...}}
//
// 跟踪: [#23](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/23)
// ============================================================

import type { EventParser } from "./types.js";
import { toolLabel } from "./types.js";

export class CodexEventParser implements EventParser {
  private resultText = "";
  onProgress?: (label: string) => void;
  onSessionId?: (sessionId: string) => void;

  feed(line: string): void {
    const t = line.trim();
    if (!t || t[0] !== "{") return;

    let evt: Record<string, unknown>;
    try {
      evt = JSON.parse(t);
    } catch {
      return;
    }

    const type = evt.type as string | undefined;

    switch (type) {
      case "thread.started": {
        // M0 实测: thread_id 是 UUID 格式的顶层字段
        // 兼容旧版/其他版本的 evt.thread?.id
        const tid =
          (evt.thread_id as string) ||
          ((evt.thread as Record<string, unknown> | undefined)
            ?.id as string);
        if (tid) this.onSessionId?.(tid);
        break;
      }

      case "turn.started":
        this.onProgress?.("🤔 Codex 思考中…");
        break;

      case "item.completed": {
        const item = evt.item as Record<string, unknown> | undefined;
        if (!item) break;

        // M0 实测: agent 消息在 item.type === "agent_message" 的 item.text
        if (item.type === "agent_message" && typeof item.text === "string") {
          this.resultText += item.text as string;
        }

        // 工具调用: item.type === "tool_use"
        if (
          (item.type as string) === "tool_use" &&
          typeof item.name === "string"
        ) {
          this.onProgress?.(toolLabel(item.name as string));
        }

        // 兼容嵌套 content（旧版或 tool-call 展开）
        const content = item.content as unknown[] | undefined;
        if (content) {
          for (const block of content) {
            const b = block as Record<string, unknown>;
            if (b.type === "output_text" && typeof b.text === "string") {
              this.resultText += b.text as string;
            }
            if (b.type === "tool_use" && typeof b.name === "string") {
              this.onProgress?.(toolLabel(b.name as string));
            }
          }
        }
        break;
      }

      case "turn.completed":
        // M0 实测: turn.completed 表示本轮结束，无 done 事件
        break;
    }
  }

  getResultText(): string {
    return this.resultText.trim();
  }
}
