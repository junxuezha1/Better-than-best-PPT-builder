# ppt-master / svg2pptx-skill read-only audit (2026-09-12)

Decision: exclude both candidates under the user's explicit rule to stop adopting candidates with multiple licenses or license ambiguity. This is not a claim that the components are inherently non-commercial; it is the user's narrower selection policy.

## hugohe3/ppt-master

- GitHub API observed 53,777 stars / 4,293 forks, not a small few-thousand-star repository. Updated and pushed on 2026-09-12; latest commit `451c68148e326383651f6319ef6f91dd2932069d` at `2026-09-12T05:13:53Z`. Not archived. Default branch main.
- Root `LICENSE` and `skills/ppt-master/LICENSE` are MIT, copyright 2025-2026 Hugo He. That claim is correct only for own code; the full repository/requirements are not uniformly MIT.
- Actual converter location: `skills/ppt-master/scripts/svg_to_pptx.py` (thin CLI) plus `skills/ppt-master/scripts/svg_to_pptx/`; not a top-level `svg_to_pptx/` directory or a standalone pip/npm package.
- Mandatory imports from `drawingml/converter.py`, `drawingml/elements.py`, and `native_objects/__init__.py` lead to `pptx_shapes`. Its `data/NOTICE.md` explicitly vendors `presetShapeDefinitions.xml` from Apache POI 5.4.1 under Apache-2.0 and `shape_type_values.txt` under Open-XML-SDK MIT. The repository also carries icons with separate licenses. Root requirements recursively include `skills/ppt-master/requirements.txt`, which includes PyMuPDF (explicit AGPL-3.0 notice; used only for PDF import), plus unrelated image-generation/web/PDF tools. Therefore do not run/install full requirements, and do not vendor full repository.
- Public Python APIs: `convert_svg_to_slide_shapes(svg_path, *, resource_root, ...) -> (slide_xml, media_files, rel_entries, anim_targets, package_files, content_type_overrides)` and `create_pptx_with_native_svg(svg_files, output_path, *, resource_root, notes, use_native_shapes=True, ...) -> bool`. Native object API includes opt-in chart/table markers. API defaults native shapes. Builder now documents `use_native_shapes` must stay true; SVG-image export unsupported (so old snapshot advice is stale). CLI calls attribution/integrity guard.
- Headless yes: Python/std-lib/python-pptx; no Office dependency for conversion. Native images become p:pic and text runs/geometry become DrawingML. Notes supported via notes dict by SVG stem. Ordered explicit path list API is available. Text-flow preserve/reflow/split supported.
- Runtime dependency declarations for SVG export: python-pptx>=0.6.21, XlsxWriter>=3.0.0, skia-pathops>=0.9.2, uharfbuzz>=0.50.0, Pillow>=9.0.0 (plus optional rendering dependencies). Source imports many sibling modules (`pptx_to_svg`, `pptx_shapes`, native_payloads, resource_paths, svg_authoring_view, svg_compatibility, language_tags, svg_finalize, animations/transitions, package validators, etc.). Downloaded converter + config/animations alone: 53 Python files ~60,554 lines; svg_to_pptx package alone 51 files (50 Python), 2.10 MB. It is no longer a small self-contained converter suitable for casual minimal vendor.
- Failure behavior conflicts with local-fallback requirement: `drawingml/converter.py:2339` preflights unsupported visual elements and raises `SvgNativeConversionError` for the entire slide; many strict authoring-contract gates also reject invalid styles/transforms/masks. A wrapper would need local normalization/rasterization before this converter.
- Maintenance evidence: recent same-day fixes explicitly address table parity, NaN/Infinity, font shaping, image alpha, redirect validation. Tree has 46 test/fixture files, including native chart/typography/image tests, and no `.github/workflows/` files at this commit. Stars prove visibility, not Office/WPS conformance. No execution of candidate scripts was performed.

Evidence URLs:
- https://api.github.com/repos/hugohe3/ppt-master
- https://github.com/hugohe3/ppt-master/tree/451c68148e326383651f6319ef6f91dd2932069d/skills/ppt-master/scripts/svg_to_pptx
- https://github.com/hugohe3/ppt-master/blob/451c68148e326383651f6319ef6f91dd2932069d/LICENSE
- https://github.com/hugohe3/ppt-master/blob/451c68148e326383651f6319ef6f91dd2932069d/skills/ppt-master/scripts/pptx_shapes/data/NOTICE.md
- https://github.com/hugohe3/ppt-master/blob/451c68148e326383651f6319ef6f91dd2932069d/skills/ppt-master/requirements.txt
- https://github.com/hugohe3/ppt-master/blob/451c68148e326383651f6319ef6f91dd2932069d/skills/ppt-master/scripts/svg_to_pptx/drawingml/converter.py#L1944
- https://github.com/hugohe3/ppt-master/blob/451c68148e326383651f6319ef6f91dd2932069d/skills/ppt-master/scripts/svg_to_pptx/pptx_package/builder.py#L6454

## JamieJustTang/svg2pptx-skill

- GitHub API observed 3 stars / 0 forks; created and last pushed 2026-06-23, unarchived; latest commit `876c188e34fefc3c4e24919494c752edf25d1ae9` at `2026-06-23T12:29:54Z`. Last three commits are README/docs additions. Tree contains 100 blobs and no tests or CI workflows.
- LICENSE declares own/core derivative MIT but explicitly bundled Heroicons MIT and Lucide ISC; GitHub detects license `NOASSERTION` (Other). Hence mixed licensing under user's exclusion rule. Not AGPL according to sampled declarations; not uniformly MIT.
- LICENSE explicitly states conversion engine extracted/adapted from Hugo He's ppt-master; not an independent mature engine. README does not pin the imported upstream commit.
- Headless CLI `python3 convert.py file.svg -o out.pptx` or folder. Wrapper stages to temp, quality-checks, finalizes, invokes converter with `--no-notes`, optionally `--svg-snapshot`; folder order lexical `sorted(glob('*.svg'))` and files copied as numbered names. It exits for quality-gate errors unless --force, but --force still can encounter converter errors.
- Lower-level package: `scripts/svg_to_pptx/`, 18 package files, ~6,000-7,000 lines total. Uses python-pptx for base package plus hand-authored DrawingML; required python-pptx>=0.6.21, Pillow>=9.0.0, lxml>=4.9.0, svglib>=1.5.0, reportlab>=4.0.0, numpy>=1.20.0. Optional cairosvg needs system Cairo.
- `drawingml_converter.py:484` also rejects any unsupported visual elements for whole slide. Transform helper doc explicitly says shear silently collapses in its 5-tuple path; native fidelity risks. No evidence of broad Office validation in source tests because none are included.

Evidence URLs:
- https://api.github.com/repos/JamieJustTang/svg2pptx-skill
- https://github.com/JamieJustTang/svg2pptx-skill/blob/876c188e34fefc3c4e24919494c752edf25d1ae9/LICENSE
- https://github.com/JamieJustTang/svg2pptx-skill/blob/876c188e34fefc3c4e24919494c752edf25d1ae9/requirements.txt
- https://github.com/JamieJustTang/svg2pptx-skill/blob/876c188e34fefc3c4e24919494c752edf25d1ae9/convert.py
- https://github.com/JamieJustTang/svg2pptx-skill/blob/876c188e34fefc3c4e24919494c752edf25d1ae9/scripts/svg_to_pptx/drawingml_converter.py

Audit boundary: fetched complete declared converter package source trees and parsed all Python files for imports; reviewed public API, dispatch, style/element imports, unsupported-element preflight, wrapper, README, licenses, actual dependency declarations, tree/test inventory, and latest commits. Did not execute upstream code. This is a targeted conversion/embedding audit, not a full security review of either entire repository.


# SVG → editable PPTX candidate audit (alternative projects)

Read-only audit fetched on 2026-09-12 (Asia/Shanghai). GitHub API metadata, fixed-SHA repository tarballs, complete repository license files, dependency declarations, and relevant converter sources were inspected. No upstream code was executed and no dependency was installed. Stars are a point-in-time count, not a maturity guarantee. Source claims about compatibility or visual fidelity are not treated as demonstrated performance.

## Findings

| Requested candidate | Resolved repository | Stars | Revision inspected | Latest HEAD commit / latest release | License and decision |
| --- | --- | ---: | --- | --- | --- |
| `solider-shuwen/shuttleslide` | GitHub redirects to `solid-shuwen/shuttleslide` | 176 | `ae3ce5c255ccab562a897d803ed527404ed2a223` | HEAD 2026-08-20; no GitHub releases; pyproject version 0.2.0, Alpha | Root and vendored converter both have complete MIT notices. Commercial use possible while retaining both notices. Not preferred because it is an HTML round-trip framework wrapping ppt-master, not a smaller independent SVG converter. |
| `BramAlkema/svg2ooxml` | unchanged | 6 | `81f2159f5fbff460f720f5263ed65112be6b009d` | HEAD 2026-08-05; repository `pushed_at` 2026-08-28; latest release v0.8.2 2026-04-30; Beta | **Excluded**: source is AGPL-3.0-only with separately sold commercial licensing; docs/assets additionally CC-BY-NC-SA-4.0. This conflicts with the user's no-AGPL / no-multiple-license requirement. |
| `benouinirachid/svg2pptx` | unchanged | 13 | `258534f43a2a38fd2c9f7827811237439d33a0fc` | HEAD / latest release v1.0.3 2026-02-02; metadata Alpha | **Excluded**: README and pyproject only say “MIT”, but all 47 repository files contain no actual LICENSE / COPYING file or full MIT grant/copyright notice; GitHub API `license: null`. Under the user's no-license-ambiguity rule, do not adopt. |

All three are unarchived. Forks and open issues: shuttleslide 6 / 0, svg2ooxml 2 / 3, svg2pptx 4 / 5. These are weak project-health signals, not correctness evidence.

## shuttleslide

- API: `from shuttleslide.html_to_pptx import RuleSlideTransformer, PPTXRenderer`; `await transformer.transform_html(html, base_dir=...)`; `PPTXRenderer(...).render(dsl, output_path)` / `.render_to_bytes(dsl)`. CLI `slidecraft to-pptx input.html -o output.pptx`.
- Conversion scope is a documented limited “Slide HTML” vocabulary. HTML layout uses headless Playwright Chromium, then PPT-DSL and python-pptx. The non-AI path can run without a model; installing core package still brings the browser runtime dependency and requires a separate Chromium installation.
- Native SVG subsystem is `src/shuttleslide/_vendored/svg_to_pptx/`. `__init__.py` re-exports `ConvertContext`, `ShapeResult`, `collect_defs`, `convert_element`, `convert_svg_to_slide_shapes`. The latter returns `(slide_xml, media_files, rel_entries, anim_targets)`. Whole-PPTX builder exists but is intentionally not re-exported by this wrapper.
- This is an adapted vendored copy of Hugo He's ppt-master engine, with its own complete MIT notice dated 2025–2026. Root license has Shuttleslide Contributors 2026. Two MIT copyright notices are consistent grants, not conflicting licenses. Upstream vendoring provenance does **not** identify the exact original ppt-master SHA and some internal attribution URLs literally contain `https://github.com/.../ppt-master`; README has the correct URL. Prefer inspecting and pinning ppt-master directly.
- Public repo has 151 Python files and only 3 tests named `test_*.py` (9 `def test_` declarations). Its Alpha declaration, July 2026 creation, no GitHub releases, limited checked-in tests, and reliance on a vendored engine do not substantiate a mature general SVG conversion library.
- Important fallback limitation: `renderer.py` catches each failed SVG child and `continue`s, potentially dropping visible content. If no children survive, `_render_svg_fallback` draws a gray rectangle with `[SVG: slot]`, not a rasterized preservation of the original. This does not satisfy the requested loss-preserving local raster fallback.
- Native dispatcher includes rect, circle, ellipse, line, path, polygon, polyline, text, image, g, nested svg. It raises `SvgNativeConversionError` for unsupported visual tags. The HTML wrapper only uses part of this API.
- Core dependencies in pyproject: `python-pptx>=0.6.21`, click, lxml, Pillow, jinja2, playwright, requests. `requirements.txt` only lists python-pptx/click/lxml/Pillow, so pyproject is the more complete install declaration.
- Optional `ai`, `review`, `camoufox`, `cloak`, and `all` extras are unrelated to SVG export and must not be pulled into a minimal integration. The cloak backend explicitly describes a separately licensed browser binary with login/licensing/OEM considerations. README's claim that listing the dependency is permitted is not independently sufficient for redistributing its binary. None is needed if selecting the direct ppt-master core.
- Vendored DrawingML core imports mainly Python standard library and optionally Pillow for raster image inspection. Its full PPTX builder imports python-pptx; SVG screenshot helper optionally tries CairoSVG / svglib / reportlab. Do not bring these broad fallback dependencies in without their own scope review.

Evidence:

- [API metadata](https://api.github.com/repos/solider-shuwen/shuttleslide)
- [Root MIT license](https://github.com/solid-shuwen/shuttleslide/blob/ae3ce5c255ccab562a897d803ed527404ed2a223/LICENSE)
- [Vendor MIT license](https://github.com/solid-shuwen/shuttleslide/blob/ae3ce5c255ccab562a897d803ed527404ed2a223/src/shuttleslide/_vendored/svg_to_pptx/LICENSE)
- [Dependency and Alpha declarations](https://github.com/solid-shuwen/shuttleslide/blob/ae3ce5c255ccab562a897d803ed527404ed2a223/pyproject.toml)
- [Vendor API](https://github.com/solid-shuwen/shuttleslide/blob/ae3ce5c255ccab562a897d803ed527404ed2a223/src/shuttleslide/_vendored/svg_to_pptx/__init__.py)
- [Renderer and fallback behavior](https://github.com/solid-shuwen/shuttleslide/blob/ae3ce5c255ccab562a897d803ed527404ed2a223/src/shuttleslide/html_to_pptx/renderer.py#L1020)
- [Optional browser license comments](https://github.com/solid-shuwen/shuttleslide/blob/ae3ce5c255ccab562a897d803ed527404ed2a223/src/shuttleslide/agent/nodes/image_sources/cloak_backend.py)

## svg2ooxml

- Most extensive tested feature surface among these three: 1,208 Python files, 301 files named `test_*.py`, approximately 3,205 test-function declarations. Includes package-part/XML tests, W3C corpus fixtures and filter/gradient/text/image fallbacks. No tests executed here, so README's “525/525” validation claim remains upstream's claim.
- Requires Python >=3.13; v0.8.2 package declares Beta. Base runtime dependencies tinycss2, click, lxml, pydantic. Optional rendering adds skia-python, Pillow, numpy. Additional API/cloud/font/billing extras are separate from the converter.
- Headless pipeline is supported by source: parse SVG, build intermediate scene, render DrawingML, package PPTX, with no Office process. `svg2ooxml.public.SvgToPptxExporter` provides `convert_file(Path, ...)` and `convert_string(svg_text, output_path, ...)`, with multi-page support in mixins. CLI is `svg2ooxml convert input.svg -o output.pptx`.
- README sample `from svg2ooxml import SvgToPptxExporter; exporter.export(...)` appears inconsistent with inspected root `__init__.py` and class method names; source exports the curated surface through `svg2ooxml.public` and exposes `convert_file` / `convert_string`. This is relevant documentation/API drift, but exclusion on license grounds already determines the decision.
- Root LICENSE explicitly calls it dual licensed, declares `SPDX-License-Identifier: AGPL-3.0-only`, and directs proprietary embedding to separately purchased terms. `pyproject.toml` agrees. `LICENSE-CONTENT` separately applies CC-BY-NC-SA-4.0 to docs, assets, visual fixtures and two template files. **No code or assets should be copied or adopted for this task**, regardless of technical promise.

Evidence:

- [API metadata](https://api.github.com/repos/BramAlkema/svg2ooxml)
- [Source license](https://github.com/BramAlkema/svg2ooxml/blob/81f2159f5fbff460f720f5263ed65112be6b009d/LICENSE)
- [Commercial license](https://github.com/BramAlkema/svg2ooxml/blob/81f2159f5fbff460f720f5263ed65112be6b009d/LICENSE-COMMERCIAL.md)
- [Content license](https://github.com/BramAlkema/svg2ooxml/blob/81f2159f5fbff460f720f5263ed65112be6b009d/LICENSE-CONTENT)
- [Dependencies](https://github.com/BramAlkema/svg2ooxml/blob/81f2159f5fbff460f720f5263ed65112be6b009d/pyproject.toml)
- [Public API](https://github.com/BramAlkema/svg2ooxml/blob/81f2159f5fbff460f720f5263ed65112be6b009d/src/svg2ooxml/public.py)
- [Converter implementation](https://github.com/BramAlkema/svg2ooxml/blob/81f2159f5fbff460f720f5263ed65112be6b009d/src/svg2ooxml/core/pptx_exporter.py#L143)

## benouinirachid/svg2pptx

- Minimal Python package: 26 Python files including examples, 3 actual tests/ files (an extra examples/test_convert.py), approximately 70 test-function declarations across all 4. There are real release tags, latest 1.0.3 February 2026, but pyproject explicitly labels Alpha and commit activity has paused for roughly seven months at audit date.
- Headless API is simple: `svg_to_pptx(svg_path, pptx_path, config=None)`, `SVGConverter.convert_string(svg_content) -> python-pptx Presentation`, `add_to_slide` and `add_string_to_slide` for batch assembly. CLI supports file/folder batch conversion. Depends on `python-pptx>=0.6.21` and `svgpathtools>=1.6.1`.
- Implements native basic shapes, paths approximated by line segments, groups and basic text. Parser's `<image>` branch is still `# TODO: Handle embedded images; return None`, which loses the user's real photos. Tspan strings are concatenated into one string, losing their individual positions/styles. Gradient handling uses a representative color; no filter/effect preservation fallback. Textbox dimensions use a character-count heuristic. These are significant gaps for old arbitrary page SVG.
- README has a one-line “MIT License”, pyproject has MIT text/classifier, but no actual license grant file or per-source copyright/license header exists in the full repository snapshot. GitHub metadata returns no detected license. **Excluded for unresolved licensing evidence**, even if the author intended MIT. Do not vendor on the assumption that a README label is the full license.

Evidence:

- [API metadata](https://api.github.com/repos/benouinirachid/svg2pptx)
- [Full fixed-SHA tree (license-file absence)](https://api.github.com/repos/benouinirachid/svg2pptx/git/trees/258534f43a2a38fd2c9f7827811237439d33a0fc?recursive=1)
- [MIT label and dependency declarations](https://github.com/benouinirachid/svg2pptx/blob/258534f43a2a38fd2c9f7827811237439d33a0fc/pyproject.toml)
- [Public API](https://github.com/benouinirachid/svg2pptx/blob/258534f43a2a38fd2c9f7827811237439d33a0fc/src/svg2pptx/__init__.py)
- [Conversion and insertion APIs](https://github.com/benouinirachid/svg2pptx/blob/258534f43a2a38fd2c9f7827811237439d33a0fc/src/svg2pptx/converter.py)
- [Unsupported embedded images](https://github.com/benouinirachid/svg2pptx/blob/258534f43a2a38fd2c9f7827811237439d33a0fc/src/svg2pptx/parser/svg_parser.py#L280)

## Selection guidance

A direct ppt-master converter was investigated next; the combined audit excluded it under the requested license scope policy, as recorded in editable-pptx-decision.md. Shuttleslide is useful independent evidence that this engine has an embedding surface, but its wrapper adds unrelated HTML/browser/AI surface and drops failed SVG children. The application must provide its own local raster fallback and native-object/package tests. The other two candidates must remain excluded under the user's license requirements.

## Dependency license cross-check

Additional read-only PyPI metadata was fetched, without installation. At audit time it reports: python-pptx 1.0.2 MIT, click 8.5.0 BSD-3-Clause, lxml 6.1.3 BSD-3-Clause, Pillow 12.3.0 MIT-CMU, Jinja2 3.1.6 BSD classifier (empty license field), Playwright 1.62.0 Apache-2.0, requests 2.34.2 Apache-2.0, svgpathtools 1.8.0 MIT. Source endpoint form is `https://pypi.org/pypi/<package>/json`, saved under `/private/tmp/svg-pptx-audit/dependency-metadata/`.

These are package metadata checks, not exhaustive distribution/transitive/bundled-native license audits and not a lockfile selection. In particular, the MIT metadata of Python wrappers cloakbrowser 0.5.10 and camoufox 0.5.6 does not license their downloaded Chromium/Firefox browser binaries. Neither optional backend should enter this integration. A selected runtime must lock and inspect its actual installed distributions.
