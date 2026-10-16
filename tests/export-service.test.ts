import assert from "node:assert/strict";
import test from "node:test";
import { createExportHandler, type ExportDependencies } from "../src/lib/export-service.ts";
import { PptxExportError, type PptxExportResult } from "../src/lib/export-types.ts";

const projectId = "project-1";
type ExportPage = ReturnType<ExportDependencies["listPages"]>[number];

function page(id = "page-1", sort = 0): ExportPage {
  return {
    id, project_id: projectId, sort_order: sort, title: `标题 ${id}`,
    speaker_notes: `备注 ${id}`, design_status: "ready", design_svg: `<svg><text>${id}</text></svg>`,
  };
}

function result(content = "PPTX"): PptxExportResult {
  return { buffer: Buffer.from(content), warnings: [], nativeTextCount: 1, nativeImageCount: 0, nativeShapeCount: 1 };
}

function fixture() {
  const state = { title: "中文演示", pages: [page()] };
  const calls: { slides: Parameters<ExportDependencies["buildPptxDetailed"]>[0]; options: Parameters<ExportDependencies["buildPptxDetailed"]>[1] }[] = [];
  const reads: string[] = [];
  const dependencies: ExportDependencies = {
    getProject: () => { reads.push("get"); return { id: projectId, title: state.title }; },
    auditProjectArtifacts: () => { reads.push("audit"); },
    listPages: () => { reads.push("list"); return state.pages; },
    buildPptxDetailed: async (slides, options) => { calls.push({ slides, options }); return result(); },
  };
  return { state, calls, reads, dependencies };
}

function request(mode?: string): Request {
  return new Request(`http://localhost/api/projects/${projectId}/export${mode === undefined ? "" : `?mode=${mode}`}`);
}

test("prepared backup metadata reaches export and invalidates the cached visibility", async () => {
  const f = fixture();
  let hidden = true;
  f.dependencies.pageMetadata = (project, pageId) => {
    assert.equal(project, projectId); assert.equal(pageId, "page-1");
    return { hidden };
  };
  const handler = createExportHandler(f.dependencies);
  assert.equal((await handler(request(), projectId)).status, 200);
  assert.equal(f.calls[0].slides[0].hidden, true);
  hidden = false;
  assert.equal((await handler(request(), projectId)).status, 200);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].slides[0].hidden, false);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("export audits before its fresh snapshot, defaults to editable, and preserves ordered titles and notes", async () => {
  const f = fixture();
  f.state.pages = [page("page-10", 10), page("page-2", 2), page("page-1", 1)];
  f.dependencies.buildPptxDetailed = async (slides, options) => {
    f.calls.push({ slides, options });
    return { ...result(), warnings: [{ slide: 2, element: "filter", reason: "raster fallback" }] };
  };
  const response = await createExportHandler(f.dependencies)(request(), projectId);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "PPTX");
  assert.deepEqual(f.reads, ["get", "audit", "get", "list"]);
  assert.deepEqual(f.calls[0].slides, ["page-1", "page-2", "page-10"].map((id) => ({
    svg: `<svg><text>${id}</text></svg>`, title: `标题 ${id}`, notes: `备注 ${id}`,
  })));
  assert.deepEqual(f.calls[0].options, { mode: "editable", title: "中文演示" });
  assert.deepEqual(f.state.pages.map((item) => item.sort_order), [10, 2, 1], "sorting must not mutate storage objects");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("X-PPTX-Fallback-Count"), "1");
  assert.equal(response.headers.get("X-PPTX-Fallback-Slides"), "2");
  assert.equal(response.headers.get("X-PPTX-Mode"), "editable");
  assert.equal(response.headers.get("Content-Type"), "application/vnd.openxmlformats-officedocument.presentationml.presentation");
});

test("missing projects return 404 before running artifact audit", async () => {
  for (const getProject of [() => null, () => { throw new Error("项目不存在"); }]) {
    const f = fixture();
    f.dependencies.getProject = getProject;
    const response = await createExportHandler(f.dependencies)(request(), projectId);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { code: "PROJECT_NOT_FOUND", error: "项目不存在" });
    assert.equal(f.reads.length, 0);
    assert.equal(f.calls.length, 0);
  }
});

test("invalid modes fail before reading project data", async () => {
  for (const mode of ["png", "", "EDITABLE"]) {
    const f = fixture();
    const response = await createExportHandler(f.dependencies)(request(mode), projectId);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "INVALID_MODE");
    assert.deepEqual(f.reads, []);
  }
});

test("empty, incomplete, and blank pages reject the entire export without dropping pages", async () => {
  for (const pages of [[], [page(), { ...page("two", 1), design_status: "stale" as const }], [page(), { ...page("two", 1), design_svg: "  " }]]) {
    const f = fixture();
    f.state.pages = pages;
    const response = await createExportHandler(f.dependencies)(request(), projectId);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "DESIGN_NOT_READY");
    assert.equal(f.calls.length, 0);
  }
});

test("artifact audit repairs are captured and audit invalidation prevents export", async () => {
  const f = fixture();
  f.dependencies.auditProjectArtifacts = () => {
    f.state.pages[0].design_svg = "<svg>repaired</svg>";
    f.state.title = "审计后的标题";
  };
  const handle = createExportHandler(f.dependencies);
  assert.equal((await handle(request(), projectId)).status, 200);
  assert.equal(f.calls[0].slides[0].svg, "<svg>repaired</svg>");
  assert.equal(f.calls[0].options.title, "审计后的标题");
  f.dependencies.auditProjectArtifacts = () => { f.state.pages[0].design_status = "stale"; };
  assert.equal((await handle(request(), projectId)).status, 409);
  assert.equal(f.calls.length, 1, "an earlier valid cached export must not bypass the audit");
});

test("export rejects pages belonging to another project and invalid numeric order", async () => {
  for (const patch of [{ project_id: "another-project" }, { sort_order: Number.NaN }]) {
    const f = fixture();
    Object.assign(f.state.pages[0], patch);
    const response = await createExportHandler(f.dependencies)(request(), projectId);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "INVALID_PAGE_ORDER");
    assert.equal(f.calls.length, 0);
  }
});

test("download headers provide safe Unicode names, ASCII fallback, and bounded filenames", async () => {
  for (const title of ["公司/季度\\收入:\r\n\"<>|*?'报告", "CON", " . ", "中".repeat(200), "broken\ud800name", "投资(报告)!"]) {
    const f = fixture();
    f.state.title = title;
    const response = await createExportHandler(f.dependencies)(request("fidelity"), projectId);
    assert.equal(response.status, 200);
    const disposition = response.headers.get("Content-Disposition") ?? "";
    assert.match(disposition, /^attachment; filename="[\x20-\x7e]+"; filename\*=UTF-8''/);
    const filename = decodeURIComponent(disposition.split("filename*=UTF-8''")[1]);
    assert.doesNotMatch(filename, /[\u0000-\u001f\u007f\\/:*?"<>|]/);
    assert.ok(Buffer.byteLength(filename, "utf8") < 180);
    assert.match(filename, /-fidelity\.pptx$/);
    if (title === "CON") assert.equal(filename, "_CON-fidelity.pptx");
    if (title.startsWith("公司")) assert.ok(filename.includes("公司"));
    assert.equal(f.calls[0].options.mode, "fidelity");
  }
});

test("builder failures are sanitized and failed exports can be retried", async () => {
  const f = fixture();
  let attempts = 0;
  f.dependencies.buildPptxDetailed = async () => {
    if (attempts++ === 0) throw new Error("secret-token at /Users/example/private.xml <svg>");
    return result("recovered");
  };
  const handle = createExportHandler(f.dependencies);
  const failure = await handle(request(), projectId);
  assert.equal(failure.status, 500);
  assert.deepEqual(await failure.json(), { code: "EXPORT_FAILED", error: "PPTX 导出失败，请重试或选择高保真 PPTX" });
  assert.equal(await (await handle(request(), projectId)).text(), "recovered");
  assert.equal(attempts, 2);
});

test("known input failures retain a useful public code without leaking exception text", async () => {
  const f = fixture();
  f.dependencies.buildPptxDetailed = async () => { throw new PptxExportError("第 2 页：/Users/private/broken.svg: parse internals", "INVALID_SVG", 422); };
  const response = await createExportHandler(f.dependencies)(request(), projectId);
  assert.equal(response.status, 422);
  const data = await response.json();
  assert.equal(data.code, "INVALID_SVG");
  assert.match(data.error, /^第 2 页：.*设计稿/);
  assert.doesNotMatch(data.error, /Users|private|internals/);
});

test("identical pending exports deduplicate and subsequent downloads reuse the result", async () => {
  const f = fixture();
  const completion = deferred<PptxExportResult>();
  const started = deferred<void>();
  let builds = 0;
  f.dependencies.buildPptxDetailed = async () => { builds++; started.resolve(); return completion.promise; };
  const handle = createExportHandler(f.dependencies);
  const first = handle(request(), projectId);
  const second = handle(request("editable"), projectId);
  await started.promise;
  assert.equal(builds, 1);
  completion.resolve(result("same deck"));
  const responses = await Promise.all([first, second]);
  assert.deepEqual(await Promise.all(responses.map((response) => response.text())), ["same deck", "same deck"]);
  assert.equal(await (await handle(request(), projectId)).text(), "same deck");
  assert.equal(builds, 1);
});

test("cache fingerprints include actual SVG, title, notes, slide identity, order and mode", async () => {
  const f = fixture();
  f.state.pages.push(page("two", 1));
  const handle = createExportHandler(f.dependencies);
  await handle(request(), projectId);
  const changes = [
    () => { f.state.pages[0].design_svg += " "; },
    () => { f.state.title += "更新"; },
    () => { f.state.pages[0].speaker_notes += "更新"; },
    () => { f.state.pages[0].title += "更新"; },
    () => { f.state.pages[0].id += "更新"; },
    () => { f.state.pages[0].sort_order = 2; },
  ];
  for (const change of changes) {
    change();
    await handle(request(), projectId);
  }
  await handle(request("fidelity"), projectId);
  assert.equal(f.calls.length, changes.length + 2);
  await handle(request("fidelity"), projectId);
  assert.equal(f.calls.length, changes.length + 2);
  assert.deepEqual(f.calls.at(-1)?.slides.map((slide) => slide.title), ["标题 two", "标题 page-1更新"]);
});

test("different versions and modes queue by project and each retains its requested snapshot", async () => {
  const f = fixture();
  const firstDone = deferred<PptxExportResult>();
  const started = deferred<void>();
  f.dependencies.buildPptxDetailed = async (slides, options) => {
    f.calls.push({ slides, options });
    if (f.calls.length === 1) { started.resolve(); return firstDone.promise; }
    return result(slides[0].notes);
  };
  const handle = createExportHandler(f.dependencies);
  const first = handle(request(), projectId);
  await started.promise;
  f.state.pages[0].speaker_notes = "新版本备注";
  const second = handle(request("fidelity"), projectId);
  await Promise.resolve();
  assert.equal(f.calls.length, 1, "the second mode should not render concurrently");
  firstDone.resolve(result("old deck"));
  assert.equal(await (await first).text(), "old deck");
  assert.equal(await (await second).text(), "新版本备注");
  assert.equal(f.calls[0].slides[0].notes, "备注 page-1");
  assert.equal(f.calls[1].slides[0].notes, "新版本备注");
  assert.equal(await (await handle(request("fidelity"), projectId)).text(), "新版本备注");
  assert.equal(f.calls.length, 2);
});

test("cache evicts least recently used results when entry or byte limits are reached", async () => {
  for (const limits of [{ maxCacheEntries: 2 }, { maxCacheBytes: 12 }]) {
    const f = fixture();
    const handle = createExportHandler(f.dependencies, limits);
    await handle(request(), projectId); // 4 buffer bytes + 2 warning JSON bytes.
    f.state.title = "second";
    await handle(request(), projectId);
    f.state.title = "中文演示";
    await handle(request(), projectId); // Keep the first entry hot.
    f.state.title = "third";
    await handle(request(), projectId);
    f.state.title = "中文演示";
    await handle(request(), projectId);
    assert.equal(f.calls.length, 3);
    f.state.title = "second";
    await handle(request(), projectId);
    assert.equal(f.calls.length, 4);
  }
});

test("oversized results are delivered but not retained in the cache", async () => {
  const f = fixture();
  const handle = createExportHandler(f.dependencies, { maxCacheBytes: 2 });
  assert.equal((await handle(request(), projectId)).status, 200);
  assert.equal((await handle(request(), projectId)).status, 200);
  assert.equal(f.calls.length, 2);
});

test("pending work is bounded while duplicate downloads can still join", async () => {
  const f = fixture();
  const completion = deferred<PptxExportResult>();
  f.dependencies.buildPptxDetailed = async () => completion.promise;
  const handle = createExportHandler(f.dependencies, { maxPendingExports: 1 });
  const first = handle(request(), projectId);
  const duplicate = handle(request(), projectId);
  const busy = await handle(request("fidelity"), projectId);
  assert.equal(busy.status, 429);
  assert.equal((await busy.json()).code, "EXPORT_BUSY");
  completion.resolve(result());
  assert.equal((await first).status, 200);
  assert.equal((await duplicate).status, 200);
});

test("async audit finishes before reading the export snapshot", async () => {
  const f = fixture(), audit = deferred<void>();
  f.dependencies.auditProjectArtifacts = async () => { await audit.promise; f.state.pages[0].design_svg = "normalized"; };
  const response = createExportHandler(f.dependencies)(request(), projectId);
  await Promise.resolve(); assert.equal(f.calls.length, 0);
  audit.resolve(); assert.equal((await response).status, 200);
  assert.equal(f.calls[0].slides[0].svg, "normalized");
});

test("aborting one shared download preserves another; aborting all subscribers cancels its worker", async () => {
  const f = fixture(), completed = deferred<PptxExportResult>();
  let workerSignal: AbortSignal | undefined;
  f.dependencies.buildPptxDetailed = (_slides, _options, signal) => { workerSignal = signal; return completed.promise; };
  const handle = createExportHandler(f.dependencies);
  const a = new AbortController(), b = new AbortController();
  const first = handle(new Request(request(), {signal:a.signal}), projectId);
  const second = handle(new Request(request(), {signal:b.signal}), projectId);
  for(let n=0;n<5;n++) await Promise.resolve();
  a.abort(); assert.equal((await first).status,499); assert.equal(workerSignal?.aborted,false);
  b.abort(); assert.equal((await second).status,499); assert.equal(workerSignal?.aborted,true);
  completed.reject(new PptxExportError("取消", "EXPORT_CANCELLED", 499));
});

test("aborted requests never audit or start a conversion", async () => {
  const f = fixture();
  const response = await createExportHandler(f.dependencies)(new Request(request(), {signal:AbortSignal.abort()}),projectId);
  assert.equal(response.status,499); assert.equal(f.calls.length,0); assert.ok(!f.reads.includes("audit"));
});

test("worker capacity, timeout, cancellation and concurrent edit failures have clear public responses", async () => {
  for(const [code,status] of [["EXPORT_BUSY",429],["EXPORT_TIMEOUT",504],["EXPORT_CANCELLED",499],["EXPORT_STALE",409]] as const) {
    const f=fixture(); f.dependencies.auditProjectArtifacts=async()=>{throw new PptxExportError("private path",code,status);};
    const response=await createExportHandler(f.dependencies)(request(),projectId);
    assert.equal(response.status,status); const body=await response.json(); assert.equal(body.code,code);assert.doesNotMatch(body.error,/private path/);
  }
});
