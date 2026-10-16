import assert from "node:assert/strict";
import test from "node:test";
import { parseMaterialProjectRequest } from "../src/lib/material-request.ts";

test("existing JSON project creation stays compatible", async () => {
  const result = await parseMaterialProjectRequest(new Request("http://localhost/api/projects", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestText: "  法学案例  ", brandTemplateId: "brand-1" }),
  }));
  assert.deepEqual(result, { requestText: "法学案例", brandTemplateId: "brand-1", usePreparedPlan: false, files: [] });
});

test("multipart keeps exact file bytes and explicit prepared-plan selection", async () => {
  const form = new FormData();
  form.set("usePreparedPlan", "true");
  form.append("files", new Blob([Uint8Array.of(0x50, 0x4b, 3, 4)]), "中文材料.zip");
  form.append("files", new Blob(["证据原文"]), "说明.md");
  const result = await parseMaterialProjectRequest(new Request("http://localhost/api/projects", { method: "POST", body: form }));
  assert.equal(result.requestText, "根据上传资料制作演示");
  assert.equal(result.usePreparedPlan, true);
  assert.equal(result.files[0].name, "中文材料.zip");
  assert.deepEqual(result.files[0].bytes, Buffer.from([0x50, 0x4b, 3, 4]));
  assert.equal(result.files[1].bytes.toString(), "证据原文");
});

test("invalid request bodies and empty material entries fail before creation", async () => {
  for (const body of ["not json", "null", "[]", '{"requestText":123}', '{}']) {
    await assert.rejects(parseMaterialProjectRequest(new Request("http://localhost/api/projects", { method: "POST", body })));
  }
  const form = new FormData();
  form.append("files", new Blob([]), "empty.png");
  await assert.rejects(parseMaterialProjectRequest(new Request("http://localhost", { method: "POST", body: form })), /文件为空/);
});

test("rejects oversized declared and streamed payloads and excessive file counts", async () => {
  await assert.rejects(parseMaterialProjectRequest(new Request("http://localhost", {
    method: "POST", headers: { "Content-Length": String(200 * 1024 * 1024) }, body: "{}",
  })), /100MB/);
  await assert.rejects(parseMaterialProjectRequest(new Request("http://localhost", {
    method: "POST", body: "x".repeat(300 * 1024),
  })), /大小限制/);
  const form = new FormData();
  for (let i = 0; i < 21; i++) form.append("files", new Blob(["x"]), `${i}.txt`);
  await assert.rejects(parseMaterialProjectRequest(new Request("http://localhost", { method: "POST", body: form })), /20 个/);
});

test("cancellation stops a pending upload read without waiting for another chunk", async () => {
  const controller = new AbortController();
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  const request = new Request("http://localhost", {
    method: "POST", body, signal: controller.signal, duplex: "half",
  } as RequestInit);
  const parsing = parseMaterialProjectRequest(request);
  controller.abort();
  await assert.rejects(parsing, /取消/);
  assert.equal(cancelled, true);
});
