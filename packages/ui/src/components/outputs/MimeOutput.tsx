import DOMPurify from "dompurify";
import { useMemo } from "react";

interface Props {
  mime: string;
  data?: string;
  url?: string;
}

export function MimeOutput({ mime, data, url }: Props) {
  // SVG content is sanitized by DOMPurify to prevent XSS
  const sanitizedSvg = useMemo(
    () => (mime === "image/svg+xml" && data ? DOMPurify.sanitize(data, { USE_PROFILES: { svg: true, svgFilters: true } }) : ""),
    [mime, data],
  );

  if (mime.startsWith("image/") && mime !== "image/svg+xml") {
    const src = data ? `data:${mime};base64,${data}` : url;
    return src ? <img src={src} style={{ maxWidth: "100%" }} alt="output" /> : null;
  }
  if (mime === "image/svg+xml" && sanitizedSvg) {
    // Safe: sanitized by DOMPurify above
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
