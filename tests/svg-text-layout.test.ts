import assert from "node:assert/strict";
import test from "node:test";
import { assertSvgTextFits, findSvgTextOverflows } from "../src/lib/svg-text-layout.ts";

const root = (content: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="1280" height="720"><rect width="1280" height="720" fill="#fff"/>${content}</svg>`;

test("detects text that extends beyond its nearest card", () => {
  const svg = root(`<g transform="translate(900 100)"><rect width="300" height="180" fill="#fff"/><text x="20" y="40" font-size="18">这是一段明显超过卡片可用宽度并且没有使用换行处理的说明文字</text></g>`);
  const issues = findSvgTextOverflows(svg);
  assert.equal(issues.length, 1);
  assert.match(issues[0].text, /明显超过卡片/);
  assert.throws(() => assertSvgTextFits(svg), /SVG 文字出框/);
});

test("accepts explicit tspan wrapping inside the card", () => {
  const svg = root(`<g transform="translate(900 100)"><rect width="300" height="180" fill="#fff"/><text x="20" y="40" font-size="18"><tspan x="20" dy="0">这是一段已经按卡片宽度</tspan><tspan x="20" dy="28">主动换行的说明文字</tspan></text></g>`);
  assert.deepEqual(findSvgTextOverflows(svg), []);
  assert.doesNotThrow(() => assertSvgTextFits(svg));
});

test("includes text transforms when selecting the containing card", () => {
  const svg = root(`<rect x="100" y="100" width="180" height="80"/><rect x="320" y="100" width="180" height="80"/><text x="16" y="30" transform="translate(320 100)" font-size="16">第二张卡片内的标题</text>`);
  assert.deepEqual(findSvgTextOverflows(svg), []);
});
