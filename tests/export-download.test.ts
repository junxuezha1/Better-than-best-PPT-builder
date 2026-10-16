import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import {
  pptxDownloadMessage,
  requestPptxDownload,
} from "../src/components/project/export-download.ts";

const PPTX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

afterEach(() => mock.restoreAll());

function mockDownload(headers: Record<string, string> = {}) {
  return mock.method(globalThis, "fetch", async () => new Response("PK test deck", {
    headers: { "Content-Type": PPTX_MEDIA_TYPE, ...headers },
  }));
}

test("download requests the selected mode and preserves the UTF-8 attachment name", async () => {
  const filename = "季度复盘-可编辑.pptx";
  let requestedUrl = "";
  let requestedSignal: AbortSignal | null | undefined;
  const controller = new AbortController();
  mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    requestedUrl = String(url);
    requestedSignal = init?.signal;
    return new Response("PK test deck", {
      headers: {
        "Content-Type": `${PPTX_MEDIA_TYPE}; charset=binary`,
        "Content-Disposition": `attachment; filename="presentation.pptx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  });
  const result = await requestPptxDownload("project/a", "editable", controller.signal);
  assert.equal(requestedUrl, "/api/projects/project%2Fa/export?mode=editable");
  assert.equal(requestedSignal, controller.signal);
  assert.equal(result.fileName, filename);
  assert.equal(await result.blob.text(), "PK test deck");
  assert.equal(pptxDownloadMessage(result, "editable"), "可编辑 PPTX 已下载");
});

test("download reports the server's partial raster fallback with ordered page numbers", async () => {
  mockDownload({
    "X-PPTX-Fallback-Count": "4",
    "X-PPTX-Fallback-Slides": "3,1,3,0,-2,abc,1.5",
  });
  const result = await requestPptxDownload("project", "editable");
  assert.equal(result.fallbackCount, 4);
  assert.deepEqual(result.fallbackSlides, [1, 3]);
  assert.equal(pptxDownloadMessage(result, "editable"), "可编辑 PPTX 已下载。第 1、3 页有 4 处复杂内容已转为图片。");
});

test("fidelity downloads have a usable name when attachment metadata is missing", async () => {
  const fetchMock = mockDownload({ "X-PPTX-Fallback-Count": "NaN" });
  const result = await requestPptxDownload("project", "fidelity");
  assert.equal(fetchMock.mock.calls[0].arguments[0], "/api/projects/project/export?mode=fidelity");
  assert.equal(result.fileName, "演示文稿-高保真.pptx");
  assert.equal(result.fallbackCount, 0);
});

test("invalid UTF-8 filename falls back to the plain name and cannot create a path", async () => {
  mockDownload({
    "Content-Disposition": 'attachment; filename="../../slides:name.pptx"; filename*=UTF-8\'\'%ZZ',
  });
  const result = await requestPptxDownload("project", "editable");
  assert.doesNotMatch(result.fileName, /[/:\\]/);
  assert.ok(result.fileName.endsWith("slides_name.pptx"));
});

test("download surfaces API errors without navigating away from the editor", async () => {
  mock.method(globalThis, "fetch", async () => Response.json({ error: "第 2 页设计稿尚未完成" }, { status: 409 }));
  await assert.rejects(requestPptxDownload("project", "editable"), /第 2 页设计稿尚未完成/);
});

test("download refuses HTML, JSON, and empty successful responses", async () => {
  for (const mediaType of ["text/html", "application/json", "application/octet-stream"]) {
    mock.method(globalThis, "fetch", async () => new Response("error", { headers: { "Content-Type": mediaType } }));
    await assert.rejects(requestPptxDownload("project", "editable"), /导出响应不是 PPTX 文件/);
  }
  mock.method(globalThis, "fetch", async () => new Response("", { headers: { "Content-Type": PPTX_MEDIA_TYPE } }));
  await assert.rejects(requestPptxDownload("project", "editable"), /导出文件为空/);
});

test("non-JSON errors use a short status message and do not expose gateway HTML", async () => {
  mock.method(globalThis, "fetch", async () => new Response("<html>Bad gateway diagnostic</html>", { status: 502 }));
  await assert.rejects(requestPptxDownload("project", "fidelity"), {
    message: "导出失败（502），请稍后重试",
  });
});

test("aborted downloads remain cancelled for the menu to ignore on unmount", async () => {
  const controller = new AbortController();
  controller.abort();
  mock.method(globalThis, "fetch", async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    init?.signal?.throwIfAborted();
    return new Response();
  });
  await assert.rejects(requestPptxDownload("project", "editable", controller.signal), { name: "AbortError" });
});
