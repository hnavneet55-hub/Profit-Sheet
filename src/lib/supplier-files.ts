import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import * as XLSX from "xlsx";

const MAX_SHEET_CHARS = 400_000;

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

/** A file or message from a supplier, in a form Claude can read. */
export type SupplierInput =
  | { kind: "sheet"; filename: string; data: ArrayBuffer; message?: string }
  | { kind: "pdf"; filename: string; data: ArrayBuffer; message?: string }
  | { kind: "image"; mediaType: ImageType; data: ArrayBuffer; message?: string }
  | { kind: "text"; text: string };

/** Picks the input kind from an uploaded file, with typed text as context (or as the input itself). */
export async function inputFromForm(file: FormDataEntryValue | null, text: string): Promise<{ input: SupplierInput; filename: string } | null> {
  const message = text || undefined;
  if (file instanceof File && file.size > 0) {
    const data = await file.arrayBuffer();
    const image = IMAGE_TYPES.find((t) => t === file.type);
    if (image) return { input: { kind: "image", mediaType: image, data, message }, filename: file.name };
    if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return { input: { kind: "pdf", filename: file.name, data, message }, filename: file.name };
    return { input: { kind: "sheet", filename: file.name, data, message }, filename: file.name };
  }
  if (text) return { input: { kind: "text", text }, filename: "Pasted text" };
  return null;
}

function sheetToText(data: ArrayBuffer): string {
  const wb = XLSX.read(data, { type: "array" });
  const out = wb.SheetNames.map((name) => `### Sheet: ${name}\n${XLSX.utils.sheet_to_csv(wb.Sheets[name], { blankrows: false })}`).join("\n\n");
  if (out.length > MAX_SHEET_CHARS) {
    throw new Error(`This sheet is too large to check in one go (${out.length.toLocaleString()} characters). Split it and upload the parts.`);
  }
  return out;
}

/** Content blocks for the file, followed by `context` and a line saying where the document is. */
export function supplierContent(input: SupplierInput, context: string, what: string): Anthropic.Beta.BetaContentBlockParam[] {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  const base64 = (d: ArrayBuffer) => Buffer.from(d).toString("base64");
  if (input.kind === "image") {
    content.push({ type: "image", source: { type: "base64", media_type: input.mediaType, data: base64(input.data) } });
  } else if (input.kind === "pdf") {
    content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: base64(input.data) } });
  }
  const note = input.kind !== "text" && input.message ? ` It was sent with the message: "${input.message}"` : "";
  const body =
    input.kind === "sheet"
      ? `The ${what} is the file "${input.filename}"${note} (each sheet as CSV):\n\n${sheetToText(input.data)}`
      : input.kind === "pdf"
        ? `The ${what} is the PDF "${input.filename}" above.${note}`
        : input.kind === "image"
          ? `The ${what} is in the image above.${note}`
          : `The ${what} as pasted text:\n\n${input.text}`;
  content.push({ type: "text", text: `${context}\n\n${body}` });
  return content;
}
