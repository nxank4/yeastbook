import DOMPurify from "dompurify";
import { useMemo, useState } from "react";

interface Props {
  mime: string;
  data?: string;
  url?: string;
  performanceMode?: boolean;
}

function estimateSize(data?: string): number {
  if (!data) return 0;
  // Base64 encoded data is ~4/3 of original size
  return Math.floor(data.length * 0.75);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function LazyMediaPlaceholder({ mime, size, onLoad }: { mime: string; size: number; onLoad: () => void }) {
  const typeLabel = mime.startsWith("image/") ? "Image" : mime.startsWith("video/") ? "Video" : "Media";
  return (
    <div className="mime-lazy-placeholder" onClick={onLoad}>
      <i className={`bi ${mime.startsWith("image/") ? "bi-image" : "bi-film"}`} />
      <span>{typeLabel} ({formatBytes(size)})</span>
      <button className="mime-lazy-btn">Click to load</button>
    </div>
  );
}

export function MimeOutput({ mime, data, url, performanceMode }: Props) {
  const [forceLoad, setForceLoad] = useState(false);

  // Content is sanitized via DOMPurify before being set as innerHTML
  const sanitizedSvg = useMemo(
    () => (mime === "image/svg+xml" && data ? DOMPurify.sanitize(data, { USE_PROFILES: { svg: true, svgFilters: true } }) : ""),
    [mime, data],
  );

  const dataSize = estimateSize(data);
  const isLarge = dataSize > 1024 * 1024; // > 1MB

  // In performance mode, show placeholder for large images/video
  if (performanceMode && isLarge && !forceLoad && (mime.startsWith("image/") || mime.startsWith("video/"))) {
    return <LazyMediaPlaceholder mime={mime} size={dataSize} onLoad={() => setForceLoad(true)} />;
  }

  if (mime.startsWith("image/") && mime !== "image/svg+xml") {
    const src = data ? `data:${mime};base64,${data}` : url;
    return src ? <img src={src} style={{ maxWidth: "100%" }} alt="output" /> : null;
  }
  if (mime === "image/svg+xml" && sanitizedSvg) {
    return <div dangerouslySetInnerHTML={{ __html: sanitizedSvg }} />;
  }
  if (mime.startsWith("audio/")) {
    return <audio controls src={url || (data ? `data:${mime};base64,${data}` : undefined)} />;
  }
  if (mime.startsWith("video/")) {
    return <video controls style={{ maxWidth: "100%" }} src={url || (data ? `data:${mime};base64,${data}` : undefined)} />;
  }
  if (mime === "application/pdf" && url) {
    return <iframe src={url} style={{ width: "100%", height: 500, border: "none" }} title="PDF" />;
  }
  return <div className="output-result">Unsupported MIME type: {mime}</div>;
}
