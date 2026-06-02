import type { RunnerSdk } from "@capakit/sdk";
import { mountMcp } from "@capakit/sdk/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { LocalImageTagger } from "./tagger_core.ts";

export function registerMcp(sdk: RunnerSdk): void {
    const tagger = new LocalImageTagger(sdk);
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
        async ({ image_path, hint, max_tags, model, mmproj }) => {
            const result = await tagger.tagImage({
                image_path,
                hint,
                max_tags,
                model,
                mmproj,
            });
            return {
                content: [
                    {
                        type: "text",
                        text: result.tags.join(", "),
                    },
                ],
                structuredContent: result,
            };
        },
    );

    mountMcp(sdk, {
        endpoint: "/mcp",
        server: mcpServer,
    });
}
