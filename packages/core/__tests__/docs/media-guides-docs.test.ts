import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const guidesRoot = "apps/docs/content/docs/guides";
const mediaRoot = `${guidesRoot}/media`;

function read(path: string): string {
  return readFileSync(`${root}${path}`, "utf8");
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(read(path)) as Record<string, unknown>;
}

function headingSlug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[`*_~]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

function headingSlugs(markdown: string): readonly string[] {
  return markdown.split("\n").flatMap((line) => {
    const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line)?.[1];
    return heading === undefined ? [] : [headingSlug(heading)];
  });
}

const mediaPages = [
  "index",
  "inputs",
  "image-generation",
  "speech-generation",
  "transcription",
  "streaming",
  "safety",
  "storage-and-delivery",
] as const;

const ownedDocs = [
  ...mediaPages.map((page) => `${mediaRoot}/${page}.mdx`),
  `${guidesRoot}/advanced/index.mdx`,
  "apps/docs/content/docs/reference/crux-core/multimodal.mdx",
  "apps/docs/content/docs/reference/crux-core/media-operations.mdx",
  "apps/docs/content/docs/reference/crux-core/media-streaming.mdx",
  "apps/docs/content/docs/reference/adapters/openai-media.mdx",
  "apps/docs/content/docs/reference/adapters/google-media.mdx",
  "apps/docs/content/docs/cookbook/basics/safe-image-generation.mdx",
  "apps/docs/content/docs/cookbook/basics/transcribe-and-narrate.mdx",
] as const;

describe("media guide information architecture", () => {
  it("promotes Media into Building blocks with a real landing page", () => {
    const guides = readJson(`${guidesRoot}/meta.json`);
    const pages = guides.pages as string[];
    const buildingBlocks = pages.indexOf("---Building blocks---");
    const contextAndMemory = pages.indexOf("---Context & memory---");
    const media = pages.indexOf("media");

    expect(media).toBeGreaterThan(buildingBlocks);
    expect(media).toBeLessThan(contextAndMemory);
    expect(read(`${guidesRoot}/index.mdx`)).toContain(
      'href="/docs/guides/media"',
    );
    expect(existsSync(`${root}${mediaRoot}/index.mdx`)).toBe(true);
  });

  it("keeps Advanced navigable without owning media", () => {
    const advanced = readJson(`${guidesRoot}/advanced/meta.json`);

    expect(advanced.pages).toContain("index");
    expect(advanced.pages).not.toContain("multimodal");
    expect(advanced.pages).not.toContain("bounded-media-streaming");
    expect(existsSync(`${root}${guidesRoot}/advanced/index.mdx`)).toBe(true);
  });

  it("covers every media reader journey with focused pages", () => {
    const media = readJson(`${mediaRoot}/meta.json`);

    expect(media.pages).toEqual(mediaPages);
    for (const page of mediaPages) {
      const source = read(`${mediaRoot}/${page}.mdx`);
      expect(source, page).toMatch(/^---\ntitle:/);
      expect(source.split("\n").length, page).toBeLessThan(300);
    }

    const landing = read(`${mediaRoot}/index.mdx`);
    for (const operation of [
      "generate()",
      "stream()",
      "generateImage()",
      "streamImage()",
      "transcribe()",
      "generateSpeech()",
      "streamSpeech()",
    ]) {
      expect(landing, operation).toContain(operation);
    }
  });

  it("separates workflow guides from exact Core references", () => {
    const coreMeta = readJson(
      "apps/docs/content/docs/reference/crux-core/meta.json",
    );

    expect(coreMeta.pages).toEqual(
      expect.arrayContaining([
        "multimodal",
        "media-operations",
        "media-streaming",
      ]),
    );
    expect(
      read("apps/docs/content/docs/reference/crux-core/multimodal.mdx"),
    ).toContain("## `MediaSource`");
    expect(
      read("apps/docs/content/docs/reference/crux-core/media-operations.mdx"),
    ).toContain("## `GenerateImageOptions`");
    expect(
      read("apps/docs/content/docs/reference/crux-core/media-streaming.mdx"),
    ).toContain("## `ImageStreamEvent`");

    expect(
      read("apps/docs/content/docs/reference/adapters/openai-media.mdx"),
    ).toContain("## `adapter.generateImage(options)`");
    expect(
      read("apps/docs/content/docs/reference/adapters/google-media.mdx"),
    ).toContain("## `adapter.transcribe(options)`");
  });

  it("keeps every owned page focused and every internal link resolvable", () => {
    const sources = ownedDocs.map((path) => read(path));
    for (const [index, source] of sources.entries()) {
      expect(source.split("\n").length, ownedDocs[index]).toBeLessThan(300);
    }

    const source = sources.join("\n");
    const links = [...source.matchAll(/\]\((\/docs\/[^)\s]+)\)/g)].map(
      (match) => match[1] as string,
    );

    expect(links.length).toBeGreaterThan(20);
    for (const link of new Set(links)) {
      const [route, fragment] = link.split("#");
      const relative = route.replace(/^\/docs\//, "");
      const file = `apps/docs/content/docs/${relative}.mdx`;
      const index = `apps/docs/content/docs/${relative}/index.mdx`;
      const target = existsSync(`${root}${file}`) ? file : index;

      expect(existsSync(`${root}${target}`), link).toBe(true);
      if (fragment !== undefined) {
        expect(headingSlugs(read(target)), link).toContain(
          decodeURIComponent(fragment),
        );
      }
    }
  });

  it("publishes two end-to-end cookbook paths", () => {
    const basics = readJson("apps/docs/content/docs/cookbook/basics/meta.json");

    expect(basics.pages).toEqual(
      expect.arrayContaining([
        "safe-image-generation",
        "transcribe-and-narrate",
      ]),
    );
    const safeImage = read(
      "apps/docs/content/docs/cookbook/basics/safe-image-generation.mdx",
    );
    expect(safeImage.replace(/\s+/g, " ")).toContain(
      "retry the same asset rather than generating another image",
    );
    expect(safeImage).toContain("saveImageRef({");
    expect(safeImage).toContain("imageId,");
    expect(safeImage).not.toMatch(/return\s+\{[^}]*ref:\s*stored\.ref/s);

    const narration = read(
      "apps/docs/content/docs/cookbook/basics/transcribe-and-narrate.mdx",
    );
    expect(narration.replace(/\s+/g, " ")).toContain(
      "three independent application decisions",
    );
    expect(narration).toContain(
      'const recording = await readFile("./recordings/weekly-sync.wav")',
    );

    const currentImageExamples = [
      ...mediaPages.map((page) => read(`${mediaRoot}/${page}.mdx`)),
      safeImage,
    ].join("\n");
    expect(currentImageExamples).not.toContain('model: "gpt-image-1"');
  });
});
