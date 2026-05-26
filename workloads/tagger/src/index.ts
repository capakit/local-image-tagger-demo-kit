import { readFile } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";

import {
    createRunnerSdk,
    endpointPath,
    hostMountMid,
    workloadMid,
} from "@capakit/sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const LLAMA_WORKLOAD = workloadMid("llama");
const LLAMA_ENDPOINT = endpointPath("/oaic");

const sdk = createRunnerSdk();
sdk.hijackConsoleLogging();

const imagesMount = sdk.mounts.get(hostMountMid("images"));
if (!imagesMount) {
    throw new Error("missing required host mount `images`");
}

const mcpServer = new McpServer({
    name: process.env.CAPAKIT_WORKLOAD_MID ?? "local-image-tagger",
    version: "0.1.0",
});

mcpServer.registerTool(
    "tag_image",
    {
        description: "Generate searchable tags for an image from the mounted images folder.",
        inputSchema: {
            image_path: z.string().describe("Path to an image inside the mounted images folder."),
            hint: z.string().optional().describe("Optional context about the image or desired tag style."),
            max_tags: z.number().int().min(1).max(30).optional().describe("Maximum number of tags."),
            model: z.string().optional().describe("Optional local vision-capable model id."),
            mmproj: z.string().optional().describe("Optional llama.cpp multimodal projector model id."),
        },
    },
    async ({ image_path, hint, max_tags = 12, model, mmproj }) => {
        const image = await mountedImage(image_path);
        const client = await sdk.workloads.oaicClient(LLAMA_WORKLOAD, LLAMA_ENDPOINT);
        const selectedModel = model ?? process.env.LOCAL_IMAGE_TAGGER_MODEL ?? "local-image-tagger";
        const response = await client.chat.completions.create({
            model: withMmproj(selectedModel, mmproj ?? process.env.LOCAL_IMAGE_TAGGER_MMPROJ),
            temperature: 0.1,
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: tagPrompt(image.relativePath, max_tags, hint),
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
        const tags = parseTags(text).slice(0, max_tags);
        return {
            content: [
                {
                    type: "text",
                    text: tags.join(", "),
                },
            ],
            structuredContent: {
                image: image.relativePath,
                model: response.model,
                tags,
                raw: text,
            },
        };
    },
);

sdk.mount({
    protocol: "mcp",
    endpoint: endpointPath("/mcp"),
    server: mcpServer,
});

await sdk.start();

async function mountedImage(inputPath: string): Promise<{
    relativePath: string;
    dataUrl: string;
}> {
    const root = resolve(imagesMount!.path);
    const candidate = resolve(root, inputPath);
    const relativePath = relative(root, candidate);
    if (isAbsolute(relativePath) || relativePath.startsWith("..")) {
        throw new Error(`image_path must stay inside the images mount`);
    }
    const bytes = await readFile(candidate);
    return {
        relativePath,
        dataUrl: `data:${mimeType(candidate)};base64,${bytes.toString("base64")}`,
    };
}

function tagPrompt(imagePath: string, maxTags: number, hint: string | undefined): string {
    return [
        `Generate up to ${maxTags} concise, searchable tags for this image.`,
        `Image path: ${imagePath}`,
        hint ? `Context: ${hint}` : "",
        "Return only a JSON array of lowercase tag strings. Avoid captions and explanations.",
    ].filter(Boolean).join("\n");
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

function mimeType(path: string): string {
    switch (extname(path).toLowerCase()) {
        case ".jpg":
        case ".jpeg":
            return "image/jpeg";
        case ".png":
            return "image/png";
        case ".webp":
            return "image/webp";
        case ".gif":
            return "image/gif";
        default:
            return "application/octet-stream";
    }
}
