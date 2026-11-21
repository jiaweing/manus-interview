export interface ModelPin {
  readonly bytes: number;
  readonly id: string;
  readonly sha256: string;
  readonly url: string;
}

export const DEFAULT_MODEL_ID = "whisper-small";

// Pin the revision as well as the LFS SHA-256; renderer input can select only an ID.
// Provenance and independently computed small-model hash: docs/model-pins.md.
export const PRODUCTION_MODEL_CATALOG: readonly ModelPin[] = Object.freeze([
  Object.freeze({
    bytes: 487_601_967,
    id: DEFAULT_MODEL_ID,
    sha256: "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-small.bin",
  }),
  Object.freeze({
    bytes: 1_533_763_059,
    id: "whisper-medium",
    sha256: "6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-medium.bin",
  }),
]);

// Exact observed redirect host for both pinned files, not *.hf.co or *.amazonaws.com.
// Fail closed if HF moves the files; a catalog update must review new hosts.
export const PRODUCTION_MODEL_HOSTS: readonly string[] = Object.freeze([
  "huggingface.co",
  "us.aws.cdn.hf.co",
]);
