import { endpointPath } from "@capakit/sdk";
import type { RunnerHttpHandlerContext } from "@capakit/sdk";
import type { RunnerSdk } from "@capakit/sdk";
import { Hono } from "hono";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LocalImageTagger } from "./tagger_core.ts";

declare const Bun: {
    file(path: string): Blob & { exists(): Promise<boolean> };
};

const sourceDir = dirname(fileURLToPath(import.meta.url));
const clientDistDir = join(sourceDir, "..", "dist", "client");

export function registerHttp(sdk: RunnerSdk): void {
    const app = createApp(sdk);
    sdk.mount({
        protocol: "http",
        endpoint: endpointPath("/http"),
        handler: async (request, context) =>
            app.fetch(requestForMountedApp(request, context)),
    });
}

function createApp(sdk: RunnerSdk): Hono {
    const tagger = new LocalImageTagger(sdk);
    const app = new Hono();

    app.get("/api/health", (c) =>
        c.json({
            ok: true,
            workload: process.env.CAPAKIT_WORKLOAD_MID ?? "local-image-tagger",
            title: "Local Image Tagger",
        }),
    );

    app.get("/api/images", async (c) => {
        return c.json({ images: await tagger.listImages() });
    });

    app.get("/api/image/blob", async (c) => {
        const imagePath = c.req.query("path");
        if (!imagePath) {
            return c.text("missing image path", 400);
        }
        const image = await tagger.readImage(imagePath);
        return new Response(arrayBufferBody(image.bytes), {
            headers: {
                "content-type": image.mimeType,
                "cache-control": "private, max-age=60",
            },
        });
    });

    app.post("/api/tags", async (c) => {
        const payload = (await c.req.json().catch(() => ({}))) as {
            image_path?: string;
            hint?: string;
            max_tags?: number;
            model?: string;
            mmproj?: string;
        };
        if (!payload.image_path) {
            return c.text("missing image_path", 400);
        }
        const result = await tagger.tagImage({
            image_path: payload.image_path,
            hint: payload.hint,
            max_tags: payload.max_tags,
            model: payload.model,
            mmproj: payload.mmproj,
        });
        return c.json(result);
    });

    app.get("/assets/*", async (c) => {
        return serveClientFile(c.req.path.slice(1));
    });

    app.get("*", async () => {
        return serveClientFile("index.html");
    });

    return app;
}

function arrayBufferBody(bytes: Uint8Array): ArrayBuffer {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer;
}

function requestForMountedApp(
    request: Request,
    context: RunnerHttpHandlerContext,
): Request {
    const url = new URL(request.url);
    const endpoint = context.endpoint.toString();
    if (endpoint !== "/" && url.pathname.startsWith(endpoint)) {
        url.pathname = url.pathname.slice(endpoint.length) || "/";
    }
    return new Request(url.toString(), request);
}

async function serveClientFile(relativePath: string): Promise<Response> {
    const filePath = safeClientFilePath(relativePath);
    if (!filePath) {
        return new Response("not found", { status: 404 });
    }
    const file = Bun.file(filePath);
    if (!(await file.exists())) {
        return new Response("not found", { status: 404 });
    }
    return new Response(file, {
        headers: {
            "content-type": contentTypeFor(filePath),
        },
    });
}

function safeClientFilePath(relativePath: string): string | null {
    const parts = relativePath
        .split("/")
        .filter((part) => part.length > 0 && part !== "." && part !== "..");
    if (parts.length === 0) {
        return join(clientDistDir, "index.html");
    }
    return join(clientDistDir, ...parts);
}

function contentTypeFor(path: string): string {
    if (path.endsWith(".html")) return "text/html; charset=utf-8";
    if (path.endsWith(".js")) return "text/javascript; charset=utf-8";
    if (path.endsWith(".css")) return "text/css; charset=utf-8";
    if (path.endsWith(".svg")) return "image/svg+xml";
    if (path.endsWith(".png")) return "image/png";
    if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
    if (path.endsWith(".webp")) return "image/webp";
    return "application/octet-stream";
}
