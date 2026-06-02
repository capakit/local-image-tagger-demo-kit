import { readFile, readdir, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";

import {
    endpointPath,
    hostMountMid,
    workloadMid,
} from "@capakit/sdk";
import type { RunnerSdk } from "@capakit/sdk";
import { createOaicClient } from "@capakit/sdk/oaic";

const LLAMA_WORKLOAD = workloadMid("llama");
const LLAMA_ENDPOINT = endpointPath("/oaic");
const SUPPORTED_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

export type ImageInfo = {
    path: string;
    name: string;
    size: number;
    modified_ms: number;
    mime_type: string;
};

export type TagImageInput = {
    image_path: string;
    hint?: string;
    max_tags?: number;
    model?: string;
    mmproj?: string;
};

export type TagImageResult = {
    image: string;
    model: string;
    tags: string[];
    raw: string;
};

export class LocalImageTagger {
    private readonly imagesRoot: string;

    constructor(private readonly sdk: RunnerSdk) {
        const imagesMount = sdk.mounts.get(hostMountMid("images"));
        if (!imagesMount) {
            throw new Error("missing required host mount `images`");
        }
        this.imagesRoot = resolve(imagesMount.path);
    }

    async listImages(): Promise<ImageInfo[]> {
        const images: ImageInfo[] = [];
        await this.walkImages("", images);
        return images.sort((a, b) => a.path.localeCompare(b.path));
    }

    async readImage(imagePath: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
        const resolved = await this.resolveImage(imagePath);
        return {
            bytes: await readFile(resolved.absolutePath),
            mimeType: mimeType(resolved.absolutePath),
        };
    }

    async tagImage(input: TagImageInput): Promise<TagImageResult> {
        const maxTags = clampMaxTags(input.max_tags ?? 12);
        const image = await this.mountedImage(input.image_path);
        const client = await createOaicClient(this.sdk, LLAMA_WORKLOAD, LLAMA_ENDPOINT);
        const selectedModel =
            input.model ?? process.env.LOCAL_IMAGE_TAGGER_MODEL ?? "local-image-tagger";
        const response = await client.chat.completions.create({
            model: withMmproj(
                selectedModel,
                input.mmproj ?? process.env.LOCAL_IMAGE_TAGGER_MMPROJ,
            ),
            temperature: 0.1,
            max_tokens: tagCompletionTokenLimit(maxTags),
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: tagPrompt(maxTags, input.hint),
                        },
                        {
                            type: "image_url",
                            image_url: { url: image.dataUrl },
                        },
                    ],
                },
            ],
        });

        const text = response.choices[0]?.message?.content ?? "";
        return {
            image: image.relativePath,
            model: response.model,
            tags: parseTags(text).slice(0, maxTags),
            raw: text,
        };
    }

    private async walkImages(relativeDir: string, images: ImageInfo[]): Promise<void> {
        const absoluteDir = this.safePath(relativeDir);
        const entries = await readdir(absoluteDir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name.startsWith(".")) {
                continue;
            }
            const relativePath = relativeDir ? join(relativeDir, entry.name) : entry.name;
            if (entry.isDirectory()) {
                await this.walkImages(relativePath, images);
                continue;
            }
            if (!entry.isFile() || !isSupportedImage(relativePath)) {
                continue;
            }
            const absolutePath = this.safePath(relativePath);
            const fileStat = await stat(absolutePath);
            images.push({
                path: relativePath,
                name: basename(relativePath),
                size: fileStat.size,
                modified_ms: fileStat.mtimeMs,
                mime_type: mimeType(absolutePath),
            });
        }
    }

    private async mountedImage(inputPath: string): Promise<{
        relativePath: string;
        dataUrl: string;
    }> {
        const resolved = await this.resolveImage(inputPath);
        const bytes = await readFile(resolved.absolutePath);
        return {
            relativePath: resolved.relativePath,
            dataUrl: `data:${mimeType(resolved.absolutePath)};base64,${bytes.toString("base64")}`,
        };
    }

    private async resolveImage(inputPath: string): Promise<{
        absolutePath: string;
        relativePath: string;
    }> {
        if (!isSupportedImage(inputPath)) {
            throw new Error("supported image formats: jpg, jpeg, png, webp");
        }
        const absolutePath = this.safePath(inputPath);
        const fileStat = await stat(absolutePath);
        if (!fileStat.isFile()) {
            throw new Error("image_path must reference a file");
        }
        return {
            absolutePath,
            relativePath: relative(this.imagesRoot, absolutePath),
        };
    }

    private safePath(inputPath: string): string {
        const candidate = resolve(this.imagesRoot, inputPath);
        const relativePath = relative(this.imagesRoot, candidate);
        if (isAbsolute(relativePath) || relativePath.startsWith("..")) {
            throw new Error("path must stay inside the images mount");
        }
        return candidate;
    }
}

function clampMaxTags(value: number): number {
    return Math.max(1, Math.min(30, Math.trunc(value)));
}

function tagPrompt(maxTags: number, hint: string | undefined): string {
    return [
        `Generate up to ${maxTags} concise, searchable tags for this image.`,
        hint ? `Context: ${hint}` : "",
        "Return only a JSON array of lowercase tag strings. Avoid captions and explanations.",
    ].filter(Boolean).join("\n");
}

function tagCompletionTokenLimit(maxTags: number): number {
    return Math.max(32, Math.min(160, maxTags * 10));
}

function parseTags(text: string): string[] {
    const parsed = tryParseJsonArray(text);
    const tags = parsed ?? text.split(/[,\n]/);
    return tags
        .map((tag) => tag.trim().toLowerCase())
        .map((tag) => tag.replace(/^["'`-]+|["'`]+$/g, ""))
        .filter(Boolean)
        .filter((tag, index, all) => all.indexOf(tag) === index);
}

function tryParseJsonArray(text: string): string[] | null {
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start < 0 || end < start) {
        return null;
    }
    try {
        const parsed = JSON.parse(text.slice(start, end + 1));
        if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
            return parsed;
        }
    } catch {}
    return null;
}

function withMmproj(model: string, mmproj: string | undefined): string {
    if (!mmproj) {
        return model;
    }
    const params = new URLSearchParams({ mmproj });
    return `${model}?${params.toString()}`;
}

function isSupportedImage(path: string): boolean {
    return SUPPORTED_IMAGE_EXTENSIONS.has(extname(path).toLowerCase());
}

function mimeType(path: string): string {
    switch (extname(path).toLowerCase()) {
        case ".jpg":
        case ".jpeg":
            return "image/jpeg";
        case ".png":
            return "image/png";
        case ".webp":
            return "image/webp";
        default:
            return "application/octet-stream";
    }
}
