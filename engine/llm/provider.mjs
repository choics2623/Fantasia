// LLM 공급자 (21 §10). 진행 루프는 이 함수 하나만 안다: complete(system, prompt, {onText}) → 전체 문자열.
//   cli  — 내 PC의 Claude Code 로그인(구독). 스트리밍(stream-json)으로 글자가 오는 대로 onText를 부른다.
//   api  — ANTHROPIC_API_KEY. 스트리밍.
//   mock — 테스트 전용. 받은 mock 함수의 결과를 그대로 돌려준다. MOCK_FAIL=0.3이면 30% 실패.
// LLM_LOG=경로 — 주고받은 글을 한 줄씩(JSONL) 남긴다. 프롬프트를 고칠 때 실제로 무엇이 갔는지 보는 개발용
import { spawn } from "node:child_process";
import { writeFile, mkdtemp, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function createProvider({ kind = process.env.LLM_PROVIDER || "cli", model = process.env.LLM_MODEL, timeoutMs = 90000 } = {}) {
  model ||= kind === "api" ? "claude-haiku-4-5" : "haiku";
  const usage = { calls: 0, failures: 0, ms: 0, outTokens: 0, since: Date.now() };
  let files = null;

  async function cliFiles(system) {
    // 시스템 프롬프트가 바뀌면 새 파일 (보통 하나)
    if (files?.systemText === system) return files;
    const dir = await mkdtemp(join(tmpdir(), "fantasia-"));
    files = { system: join(dir, "system.txt"), settings: join(dir, "settings.json"), systemText: system };
    await writeFile(files.system, system, "utf8");
    // 생각(thinking)을 끈다 — 켜 두면 30~80초, 끄면 5~10초
    await writeFile(files.settings, JSON.stringify({ alwaysThinkingEnabled: false }), "utf8");
    return files;
  }

  function cli(system, prompt, { onText }) {
    return cliFiles(system).then((f) => new Promise((resolve, reject) => {
      const args = ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--model", model, "--tools", "", "--no-session-persistence", "--system-prompt-file", f.system, "--settings", f.settings];
      const win = process.platform === "win32";
      const p = spawn("claude", win ? args.map((a) => `"${a.replace(/"/g, '\\"')}"`) : args, { shell: win, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, MAX_THINKING_TOKENS: "0" } });
      let buf = "", err = "", text = "", final = null;
      const timer = setTimeout(() => { p.kill(); reject(new Error(`시간 초과 (${timeoutMs / 1000}초)`)); }, timeoutMs);
      p.stdout.on("data", (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line) continue;
          let ev; try { ev = JSON.parse(line); } catch { continue; }
          // 글자 조각: stream_event → content_block_delta → text_delta
          const delta = ev.type === "stream_event" && ev.event?.type === "content_block_delta" ? ev.event.delta?.text : null;
          if (delta) { text += delta; onText?.(delta, text); }
          if (ev.type === "result") final = ev;
        }
      });
      p.stderr.on("data", (d) => (err += d));
      p.on("error", (e) => { clearTimeout(timer); reject(new Error("claude 실행 실패 — Claude Code가 설치·로그인되어 있나요? " + e.message)); });
      p.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0 && !final) return reject(new Error(`claude 종료 코드 ${code}: ${(err || buf).slice(0, 300)}`));
        if (final?.is_error) return reject(new Error("claude 오류: " + String(final.result).slice(0, 300)));
        usage.outTokens += final?.usage?.output_tokens || 0;
        resolve(final?.result ?? text);
      });
      p.stdin.end(prompt, "utf8");
    }));
  }

  let client = null;
  async function api(system, prompt, { onText }) {
    if (!client) {
      const { default: Anthropic } = await import("@anthropic-ai/sdk").catch(() => { throw new Error("npm i @anthropic-ai/sdk 를 먼저 실행하세요"); });
      client = new Anthropic();
    }
    const stream = client.messages.stream({
      model, max_tokens: 2000,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: prompt }],
    });
    let text = "";
    stream.on("text", (d) => { text += d; onText?.(d, text); });
    const msg = await stream.finalMessage();
    usage.outTokens += msg.usage?.output_tokens || 0;
    return text;
  }

  async function complete(system, prompt, { onText, mock } = {}) {
    const t0 = Date.now(); usage.calls++;
    try {
      let out;
      if (kind === "mock") {
        if (Math.random() < Number(process.env.MOCK_FAIL || 0)) throw new Error("가짜 LLM: 실패 흉내");
        out = mock ? mock() : "";
        for (const piece of out.match(/[\s\S]{1,40}/g) || []) onText?.(piece);
      } else out = kind === "api" ? await api(system, prompt, { onText }) : await cli(system, prompt, { onText });
      usage.ms += Date.now() - t0;
      if (process.env.LLM_LOG) appendFile(process.env.LLM_LOG, JSON.stringify({ at: new Date().toISOString(), model, ms: Date.now() - t0, system: String(system).slice(0, 60), prompt, out }) + "\n").catch(() => {});
      return out;
    } catch (e) { usage.failures++; throw e; }
  }
  return { complete, kind, model, usage };
}
