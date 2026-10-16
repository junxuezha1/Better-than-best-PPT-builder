import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import {
  generateSvg,
  generateText,
  isRecoverableModelOutputError,
} from "../src/lib/model-gateway.ts";
import type { ModelConfig } from "../src/lib/types.ts";

const config: ModelConfig = {
  baseUrl: "https://gateway.example",
  apiKey: "test-key",
  protocol: "chat_completions",
  model: "test-model",
};

afterEach(() => mock.restoreAll());

test("SVG asset transform runs before safety validation without bypassing it", async () => {
  const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="1280" height="720"><rect width="1280" height="720" fill="#fff"/><text x="80" y="120" font-size="42">ASSET_LABEL</text></svg>';
  mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ choices: [{ message: { content: source } }] }), {
    headers: { "Content-Type": "application/json" },
  }));
  const result = await generateSvg(config, [{ role: "user", content: "test" }], {
    repairInvalidOutput: false, outputTransform: (text) => text.replace("ASSET_LABEL", "Imported material"),
  });
  assert.match(result, /Imported material/);
  await assert.rejects(generateSvg(config, [{ role: "user", content: "test" }], {
    repairInvalidOutput: false, outputTransform: (text) => text.replace("</svg>", '<script>alert(1)</script></svg>'),
  }));
});

test("model gateway retries a transient generation failure", async () => {
  let calls = 0;
  let requestBody: Record<string, unknown> | undefined;
  mock.method(globalThis, "fetch", async (
    _input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    calls += 1;
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    if (calls === 1) {
      return new Response(JSON.stringify({ error: { message: "model at capacity" } }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: "ready" } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  const result = await generateText(config, [{ role: "user", content: "hello" }], {
    retryDelaysMs: [0],
  });

  assert.equal(result, "ready");
  assert.equal(calls, 2);
  assert.equal(requestBody?.stream, true);
});

test("model gateway does not start a request after cancellation", async () => {
  const controller = new AbortController();
  controller.abort();
  let called = false;
  mock.method(globalThis, "fetch", async () => {
    called = true;
    return new Response();
  });

  await assert.rejects(
    generateText(config, [{ role: "user", content: "hello" }], {
      signal: controller.signal,
    }),
    /CANCELLED/,
  );
  assert.equal(called, false);
});

test("malformed structured model output is recoverable", () => {
  assert.equal(
    isRecoverableModelOutputError(
      new SyntaxError("Expected ',' or '}' after property value in JSON at position 2161"),
    ),
    true,
  );
  assert.equal(isRecoverableModelOutputError(new Error("项目不存在")), false);
  assert.equal(isRecoverableModelOutputError(new Error("CANCELLED")), false);
});

test("upstream connection failures are retried", async () => {
  let calls = 0;
  mock.method(globalThis, "fetch", async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({ error: { message: "Upstream request failed" } }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: "ready" } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  const result = await generateText(config, [{ role: "user", content: "hello" }], {
    retryDelaysMs: [0],
  });

  assert.equal(result, "ready");
  assert.equal(calls, 2);
});

test("SVG generation repairs one invalid model output", async () => {
  let calls = 0;
  mock.method(globalThis, "fetch", async () => {
    calls += 1;
    const content = calls === 1
      ? '<svg viewBox="0 0 1280 720" width="1280" height="720"><text>内容待补充</text></svg>'
      : '<svg viewBox="0 0 1280 720" width="1280" height="720"><rect width="1280" height="720" fill="#f5f7fa"/><text x="80" y="120" font-size="60" fill="#111827">可信内容</text></svg>';
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  const svg = await generateSvg(config, [{ role: "user", content: "make a slide" }]);

  assert.match(svg, /可信内容/);
  assert.equal(calls, 2);
});

test("SVG generation allows a second validation repair", async () => {
  let calls = 0;
  mock.method(globalThis, "fetch", async () => {
    calls += 1;
    const content = calls < 3
      ? '<svg viewBox="0 0 1280 720" width="1280" height="720"><text>内容待补充</text></svg>'
      : '<svg viewBox="0 0 1280 720" width="1280" height="720"><rect width="1280" height="720" fill="#f5f7fa"/><text x="80" y="120" font-size="60" fill="#111827">二次修复完成</text></svg>';
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  const svg = await generateSvg(config, [{ role: "user", content: "make a slide" }]);

  assert.match(svg, /二次修复完成/);
  assert.equal(calls, 3);
});
