# local-image-tagger

Local image tagging kit powered by the bundled `llama-cpp-local` kit.

## What it exposes

- HTTP UI at `/`: browse mounted image files, preview an image, and generate tags.
- MCP endpoint at `/mcp`: `tag_image` tool for tagging an image by path.
- Default vision model: `ggml-org/SmolVLM2-500M-Video-Instruct-GGUF:Q8_0`.

## Required mounts

- `images`: read-only folder containing `.jpg`, `.jpeg`, `.png`, or `.webp` files.
- `models`: read/write cache folder used by the bundled llama.cpp dependency.

## Run

```sh
capakit up . --mount images=/path/to/images --mount models=/path/to/model-cache
```

Then open the exposed HTTP URL from `capakit up`, or call the MCP endpoint with:

```sh
capakit mcp list-tools --kit .
```

## Validate workload build

```sh
capakit exec tagger --mount images=/path/to/images -- bun install
capakit exec tagger --mount images=/path/to/images -- bun run build
```

## Run capability test

The test image is auto-bound from `tests/tags-fixture-image/images`.

```sh
capakit test . --mount models=/path/to/model-cache
```
