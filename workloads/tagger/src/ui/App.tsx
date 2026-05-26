import { useEffect, useMemo, useState } from "react";

type ImageInfo = {
    path: string;
    name: string;
    size: number;
    modified_ms: number;
    mime_type: string;
};

type TagResult = {
    image: string;
    model: string;
    tags: string[];
    raw: string;
};

export function App() {
    const [images, setImages] = useState<ImageInfo[]>([]);
    const [selectedPath, setSelectedPath] = useState<string | null>(null);
    const [hint, setHint] = useState("");
    const [maxTags, setMaxTags] = useState(12);
    const [result, setResult] = useState<TagResult | null>(null);
    const [loadingImages, setLoadingImages] = useState(true);
    const [tagging, setTagging] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        void refreshImages();
    }, []);

    const selectedImage = useMemo(
        () => images.find((image) => image.path === selectedPath) ?? null,
        [images, selectedPath],
    );
    const selectedResult = result?.image === selectedImage?.path ? result : null;

    async function refreshImages() {
        setLoadingImages(true);
        setError(null);
        try {
            const response = await fetch("/api/images");
            if (!response.ok) {
                throw new Error(await response.text());
            }
            const payload = (await response.json()) as { images: ImageInfo[] };
            setImages(payload.images);
            setSelectedPath((current) => current ?? payload.images[0]?.path ?? null);
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setLoadingImages(false);
        }
    }

    async function tagSelectedImage() {
        if (!selectedImage) {
            return;
        }
        setTagging(true);
        setError(null);
        setResult(null);
        try {
            const response = await fetch("/api/tags", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    image_path: selectedImage.path,
                    hint: hint.trim() || undefined,
                    max_tags: maxTags,
                }),
            });
            if (!response.ok) {
                throw new Error(await response.text());
            }
            setResult((await response.json()) as TagResult);
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setTagging(false);
        }
    }

    return (
        <main className="app-shell">
            <aside className="sidebar">
                <div className="toolbar">
                    <div>
                        <p className="eyebrow">Mounted folder</p>
                        <h1>Local Image Tagger</h1>
                    </div>
                    <button type="button" onClick={() => void refreshImages()}>
                        Refresh
                    </button>
                </div>

                <div className="image-list" aria-busy={loadingImages}>
                    {images.map((image) => (
                        <button
                            className={image.path === selectedPath ? "image-row selected" : "image-row"}
                            title={image.path}
                            key={image.path}
                            type="button"
                            onClick={() => {
                                setSelectedPath(image.path);
                                setResult(null);
                                setError(null);
                            }}
                        >
                            <img src={imageUrl(image.path)} alt="" />
                            <span>
                                <strong>{image.name}</strong>
                                <small>{image.path}</small>
                            </span>
                        </button>
                    ))}
                    {!loadingImages && images.length === 0 ? (
                        <p className="empty">No jpg, png, or webp images found.</p>
                    ) : null}
                </div>
            </aside>

            <section className="workspace">
                {selectedImage ? (
                    <>
                        <div className="preview">
                            <img src={imageUrl(selectedImage.path)} alt={selectedImage.name} />
                        </div>

                        <div className="panel">
                            <div className="panel-heading">
                                <div>
                                    <p className="eyebrow">Selected image</p>
                                    <h2 title={selectedImage.path}>{selectedImage.name}</h2>
                                </div>
                                <span>{formatBytes(selectedImage.size)}</span>
                            </div>
                            <p className="selected-path" title={selectedImage.path}>
                                {selectedImage.path}
                            </p>

                            <label>
                                Hint
                                <textarea
                                    value={hint}
                                    onChange={(event) => setHint(event.target.value)}
                                    placeholder="Optional context or tag style"
                                />
                            </label>

                            <label>
                                Max tags
                                <input
                                    min={1}
                                    max={30}
                                    type="number"
                                    value={maxTags}
                                    onChange={(event) => setMaxTags(Number(event.target.value))}
                                />
                            </label>

                            <button
                                className="primary"
                                type="button"
                                disabled={tagging}
                                onClick={() => void tagSelectedImage()}
                            >
                                {tagging ? "Tagging..." : "Generate tags"}
                            </button>

                            {error ? <p className="error">{error}</p> : null}
                            {tagging ? <p className="status">Generating tags for {selectedImage.name}</p> : null}
                            {selectedResult ? (
                                <section className="result-panel" aria-live="polite">
                                    <div className="result-heading">
                                        <div>
                                            <p className="eyebrow">Generated tags</p>
                                            <h3>{selectedResult.tags.length} tags</h3>
                                        </div>
                                        <small>{selectedResult.model}</small>
                                    </div>
                                    <div className="tags">
                                        {selectedResult.tags.map((tag) => (
                                            <span key={tag} title={tag}>{tag}</span>
                                        ))}
                                    </div>
                                </section>
                            ) : null}
                        </div>
                    </>
                ) : (
                    <div className="placeholder">Select an image to begin.</div>
                )}
            </section>
        </main>
    );
}

function imageUrl(path: string): string {
    return `/api/image/blob?path=${encodeURIComponent(path)}`;
}

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
