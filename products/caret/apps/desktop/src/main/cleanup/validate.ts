import { CleanupError } from "./provider";

const NUMBER_WORDS = new Set(
  `zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen
  twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million billion trillion
  first second third fourth fifth sixth seventh eighth ninth tenth eleventh twelfth thirteenth fourteenth fifteenth sixteenth seventeenth eighteenth nineteenth
  twentieth thirtieth fortieth fiftieth sixtieth seventieth eightieth ninetieth hundredth thousandth millionth billionth trillionth
  half halves quarter quarters dozen dozens`.split(/\s+/)
);

// Deliberately lexical, not arithmetic: separators/decimals/currency/percent matter.
// Capture Unicode digits too; whitespace grouping only joins groups of three digits.
const NUMERIC_OR_WORD =
  /[+−-]?\p{Sc}?\s*(?:\p{Nd}+(?:(?:[.,/:−-]|[ '\u00a0\u202f](?=\p{Nd}{3}(?!\p{Nd})))\p{Nd}+)*|[.]\p{Nd}+)(?:[ \t]*[%‰])?(?:st|nd|rd|th)?|\p{L}+/gu;
const HAS_DIGIT = /\p{Nd}/u;
const LINE_FORMAT = /^\s*(?:#{1,6}\s|[-+*]\s|>\s|\d+[.)]\s|\|.*\|)/m;
const MARKUP =
  /`|\*\*|__|~~[^~\n]+~~|\*[^*\n]+\*|\b_[^_\n]+_\b|!?\[[^\]\n]+\]\([^\n]*\)|<\/?[a-z][^>]*>/i;
const THEMATIC_BREAK = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/m;
const JSON_WRAPPER = /^\s*[[{]/;
const CONTROL_OR_INVISIBLE = /[\p{Cc}\p{Cf}]/gu;
// JSON.parse validates escapes; this additionally requires exactly one lexical key.
const SINGLE_STRING_FIELD =
  /^\s*\{\s*"(?:[^"\\]|\\.)*"\s*:\s*"(?:[^"\\]|\\.)*"\s*\}\s*$/s;

/**
 * Ordered exact digit lexemes plus case-folded English number words.
 * No value conversion: 3 != three, 1,000 != 1000, $20 != 20, 50% != 50.
 * Number-word hyphen/space differences are ignored; word order is not.
 * See cleanup/README.md for the vocabulary and intentionally conservative limits.
 */
export function numericTokens(text: string): string[] {
  const tokens: string[] = [];
  for (const match of text.matchAll(NUMERIC_OR_WORD)) {
    const token = match[0].trim();
    if (HAS_DIGIT.test(token)) {
      tokens.push(token);
    } else if (NUMBER_WORDS.has(token.toLowerCase())) {
      tokens.push(token.toLowerCase());
    }
  }
  return tokens;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Throws safe typed errors; never returns partial or repaired invalid output. */
export function validateCleanupOutput(
  content: string,
  transcript: string
): string {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    // biome-ignore lint/style/useErrorCause: JSON parser errors can quote dictation; retain no cause.
    throw new CleanupError("invalid_json");
  }
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 1 ||
    typeof value.text !== "string" ||
    !SINGLE_STRING_FIELD.test(content)
  ) {
    throw new CleanupError("invalid_response");
  }
  const text = value.text.trim();
  if (!text) {
    throw new CleanupError("empty_text");
  }
  // Plain paragraphs allow LF, CR, and tab, but no other controls/invisibles.
  const withoutWhitespace = text.replace(/[\n\r\t]/g, "");
  if (
    LINE_FORMAT.test(text) ||
    MARKUP.test(text) ||
    THEMATIC_BREAK.test(text) ||
    JSON_WRAPPER.test(text) ||
    withoutWhitespace.match(CONTROL_OR_INVISIBLE)
  ) {
    throw new CleanupError("non_plain_text");
  }
  const before = numericTokens(transcript);
  const after = numericTokens(text);
  if (
    before.length !== after.length ||
    before.some((token, index) => token !== after[index])
  ) {
    throw new CleanupError("changed_numbers");
  }
  return text;
}
