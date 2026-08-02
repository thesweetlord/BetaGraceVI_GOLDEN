import { readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

export type LegalDocumentKind = "privacy" | "terms";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, "..");

const LEGAL_DOCUMENT_PATHS: Record<LegalDocumentKind, string> = {
  privacy: path.join(projectRoot, "PRIVACY_POLICY.md"),
  terms: path.join(projectRoot, "TERMS_OF_SERVICE.md"),
};

const PRIVACY_QUERY_RE = /\b(privacy|privacy policy|data retention|data delete|delete my data|export my data|gdpr|ccpa|coppa|personal data|retention|consent|erasure|portability)\b/i;
const TERMS_QUERY_RE = /\b(terms|terms of service|tos|conditions|liability|governing law|prohibited uses|acceptable use|eligibility|age requirement)\b/i;
const LEGAL_QUERY_RE = /\b(privacy|policy|terms|tos|gdpr|ccpa|coppa|legal|retention|consent|liability|governing law|acceptable use|prohibited uses)\b/i;

export async function readLegalDocument(kind: LegalDocumentKind): Promise<string> {
  return readFile(LEGAL_DOCUMENT_PATHS[kind], "utf8");
}

export function isLegalPolicyQuery(message: string): boolean {
  return LEGAL_QUERY_RE.test(message);
}

export async function buildLegalPromptContext(message: string): Promise<string> {
  const wantsPrivacy = PRIVACY_QUERY_RE.test(message);
  const wantsTerms = TERMS_QUERY_RE.test(message);

  const includePrivacy = wantsPrivacy || (!wantsPrivacy && !wantsTerms);
  const includeTerms = wantsTerms || (!wantsPrivacy && !wantsTerms);

  const sections: string[] = [
    "[LIVE LEGAL DOCUMENTS — SOURCE OF TRUTH]",
    "Use the following live project documents as the authoritative source for legal/policy answers.",
    "If a user asks about privacy, terms, retention, consent, deletion, export, age requirements, liability, or governing law, answer from these documents rather than paraphrasing from memory.",
    "If the documents do not cover something, say so plainly instead of inventing policy.",
  ];

  if (includePrivacy) {
    const privacyPolicy = await readLegalDocument("privacy");
    sections.push(`[LIVE PRIVACY POLICY]\n${privacyPolicy}\n[END LIVE PRIVACY POLICY]`);
  }

  if (includeTerms) {
    const termsOfService = await readLegalDocument("terms");
    sections.push(`[LIVE TERMS OF SERVICE]\n${termsOfService}\n[END LIVE TERMS OF SERVICE]`);
  }

  return `\n\n${sections.join("\n\n")}`;
}
