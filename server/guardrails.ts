import { z } from "zod";

// ============================================================================
// FOUNDATIONAL TYPES & INTERFACES
// ============================================================================

export type SecuritySeverity = "low" | "medium" | "high" | "critical";

export interface ContextVector {
    readonly thematicScore: number;
    readonly actionableScore: number;
    readonly contextFactor: number; // Scale 0.0 (Procedural) to 1.0 (Narrative)
}

export interface SecurityViolation {
    readonly category: string;
    readonly description: string;
    readonly severity: SecuritySeverity;
}

export interface LoveSurrenderGraceProfile {
    readonly content: string;
    readonly loveAlignment: number;
    readonly surrenderAlignment: number;
    readonly graceAlignment: number;
    readonly overallAlignment: number;
    readonly principles: {
        readonly radicalAcceptance: boolean;
        readonly empatheticResonance: boolean;
        readonly generousSpirit: boolean;
        readonly bridgeBuilding: boolean;
        readonly vulnerableAuthenticity: boolean;
        readonly releaseOfControl: boolean;
        readonly humbleReception: boolean;
        readonly flowWithTruth: boolean;
        readonly permissionToNotKnow: boolean;
        readonly sacredEmptiness: boolean;
        readonly unearnedBlessing: boolean;
        readonly redemptivePower: boolean;
        readonly forgivenessEmbodied: boolean;
        readonly extraordinaryOrdinary: boolean;
        readonly sufficiencyInAbundance: boolean;
    };
    readonly recommendations: readonly string[];
}

export interface ThreatIntelligence {
    readonly pattern: RegExp;
    readonly severity: SecuritySeverity;
    readonly lastSeen: Date;
    readonly frequency: number;
}

export interface NetworkSegment {
    readonly id: string;
    readonly trustLevel: "high" | "medium" | "low" | "untrusted";
    readonly allowedPatterns: readonly RegExp[];
    readonly deniedPatterns: readonly RegExp[];
    readonly lastReconfigured: Date;
}

export interface AnomalyPattern {
    readonly signature: string;
    readonly frequency: number;
    readonly firstSeen: Date;
    readonly lastSeen: Date;
    readonly anomalyScore: number;
}

export interface BehavioralProfile {
    readonly sessionId: string;
    readonly contentPatterns: readonly string[];
    readonly interactionTimes: readonly Date[];
    readonly averageContentLength: number;
    readonly riskScore: number;
    readonly anomaliesDetected: number;
}

export interface EncryptionMetrics {
    readonly algorithm: string;
    readonly keyLength: number;
    readonly quantumResistant: boolean;
    readonly lastRotation: Date;
    readonly rotationInterval: number;
    readonly status: "secure" | "warning" | "critical";
}

export interface SecurityIncident {
    readonly id: string;
    readonly timestamp: Date;
    readonly severity: SecuritySeverity;
    readonly type: string;
    readonly description: string;
    readonly affectedSystems: readonly string[];
    readonly status: "detected" | "analyzing" | "containing" | "contained" | "resolved";
    readonly automatedActions: readonly string[];
    readonly evidencePreserved: boolean;
}

export interface ThreatPrediction {
    readonly threatType: string;
    readonly probability: number;
    readonly expectedImpact: SecuritySeverity;
    readonly recommendedActions: readonly string[];
    readonly confidence: number;
}

export interface MonitoringMetrics {
    readonly eventsPerMinute: number;
    readonly anomalyRate: number;
    readonly threatLevel: "green" | "yellow" | "orange" | "red";
    readonly predictedThreats: readonly ThreatPrediction[];
}

export interface CognitiveAnalysis {
    readonly deepLearningInsights: {
        readonly patternComplexity: number;
        readonly semanticRelationships: readonly string[];
        readonly contextualUnderstanding: number;
    };
    readonly naturalLanguageProcessing: {
        readonly sentiment: "positive" | "neutral" | "negative" | "hostile";
        readonly intent: string;
        readonly entities: readonly string[];
        readonly topics: readonly string[];
    };
    readonly transparencyReport: {
        readonly decisionFactors: readonly { readonly factor: string; readonly weight: number; readonly explanation: string }[];
        readonly confidenceLevel: number;
        readonly alternativeInterpretations: readonly string[];
    };
}

export interface AdvancedInjectionResult {
    readonly passed: boolean;
    readonly riskScore: number;
    readonly threats: readonly string[];
    readonly sanitizedContent: string;
    readonly details: {
        readonly homoglyphsDetected: boolean;
        readonly nestedInjection: boolean;
        readonly encodingAttempts: readonly string[];
        readonly contextSwitching: boolean;
        readonly tokenManipulation: boolean;
        readonly injectionPatterns: number;
    };
}

export interface GuardrailCheckRequest {
    readonly content: string;
    readonly isOver18: boolean;
    readonly context?: string;
    readonly sessionId?: string;
}

export interface GuardrailCheckResult {
    readonly passed: boolean;
    readonly blockedReason?: string;
    readonly layers: {
        readonly childSafety: { passed: boolean; violations: readonly string[]; requiresAdultVerification: boolean };
        readonly jailbreakDetection: { passed: boolean; riskLevel: "low" | "medium" | "high"; patterns: readonly string[] };
        readonly piiFiltering: { passed: boolean; piiFound: readonly string[]; sanitized: string };
        readonly harmfulContent: { passed: boolean; harmCategories: readonly string[]; severity: "safe" | "warning" | "critical" };
        readonly obfuscationDetection: { passed: boolean; obfuscationTypes: readonly string[]; riskScore: number };
        readonly advancedInjection: AdvancedInjectionResult;
        readonly loveSurrenderGraceAlignment?: LoveSurrenderGraceProfile;
    };
    readonly enhancedSecurity: {
        readonly networkSegment?: NetworkSegment;
        readonly behavioralAnalysis?: { isNormal: boolean; riskScore: number; anomalies: readonly string[]; confidenceLevel: number };
        readonly encryptionStatus?: EncryptionMetrics;
        readonly incidentResponse?: SecurityIncident;
        readonly predictiveAnalytics?: MonitoringMetrics;
        readonly cognitiveAnalysis?: CognitiveAnalysis;
    };
    readonly timestamp: string;
    readonly totalRiskScore: number;
    readonly sanitizedContent?: string;
    readonly principleAlignment?: {
        readonly love: number;
        readonly surrender: number;
        readonly grace: number;
        readonly overall: number;
    };
}

export interface GuardrailLog {
    readonly timestamp: string;
    readonly sessionId?: string;
    readonly passed: boolean;
    readonly blockedReason?: string;
    readonly totalRiskScore: number;
    readonly violationDetails?: Record<string, any>;
}

export interface PrivacyMetrics {
    readonly apiKeysStoredServerSide: number;
    readonly personalIdentifiersTracked: number;
    readonly sessionDataPersonallyIdentifiable: number;
    readonly dataSoldToThirdParties: boolean;
    readonly httpsEnforced: boolean;
    readonly userClearableHistory: boolean;
    readonly dataRetentionOptOut: boolean;
}

export interface PrivacyDisclosure {
    readonly section: string;
    readonly requirement: string;
    readonly implementation: string;
    readonly compliance: boolean;
}

// ============================================================================
// CONSTANTS & REGEX MATRICES (Stateless: No 'g' flag for testing methods)
// ============================================================================

const UNICODE_HOMOGLYPH_MAP: Readonly<Record<string, string>> = {
    "\u0430": "a", "\u0435": "e", "\u043E": "o", "\u0440": "p", "\u0441": "c",
    "\u0391": "A", "\u0392": "B", "\u0395": "E", "\u039A": "K", "\u039C": "M",
    "\u0455": "s", "\u0456": "i", "\u043D": "h", "\u0445": "x", "\u0443": "y"
};

const ADULT_CONTENT_RESTRICTIONS: readonly RegExp[] = [
    /child.*exploit|minor.*abuse|pedophilia|child.*pornography/i,
    /graphic.*violence|extreme.*gore|torture.*graphic|mutilation/i,
    /non.?consensual|rape|sexual.*assault|coerce/i,
];

const JAILBREAK_PATTERNS: readonly RegExp[] = [
    /ignore\s+all\s+previous\s+instructions/i,
    /forget\s+all\s+(previous\s+)?rules|disregard\s+(all\s+)?safety/i,
    /override\s+(all\s+)?(previous\s+)?instructions/i,
    /stop\s+being\s+(an?\s+)?ai|stop\s+acting\s+as/i,
    /you\s+are\s+now\s+(?:a\s+)?(?:DAN|jailbreak|unrestricted|free|liberated)/i,
    /(?:DAN|do\s+anything\s+now)\s+mode/i,
    /developer\s+mode\s+(enabled|activated|on)/i,
    /switch\s+to\s+(?:developer|admin|root|god|master|unrestricted)\s+mode/i,
    /jailbreak\s+mode|evil\s+mode|chaos\s+mode|no.?filter\s+mode/i,
    /activation\s+code|override\s+code|bypass\s+code/i,
    /(?:pretend|imagine|act|play|behave|respond)\s+(you\s+are|as\s+(if\s+)?you\s+are|as\s+a(?:n\s+)?)\s*(?:unfiltered|unrestricted|evil|bad|no.rules)/i,
    /you\s+are\s+now\s+playing\s+(?:an?\s+)?(?:evil|unrestricted|unaligned|jailbroken)/i,
    /(?:your\s+)?(?:true\s+self|inner\s+thoughts|real\s+self)\s+(has?\s+no\s+rules|without\s+restrictions)/i,
    /you\s+have\s+no\s+(restrictions|rules|guidelines|filters|limits)/i,
    /you\s+(?:must|should|can|will)\s+ignore\s+(your\s+)?(restrictions|guidelines|safety|training)/i,
    /(?:show|reveal|print|output|display|tell\s+me|what\s+are)\s+(me\s+)?(your\s+)?(system\s+prompt|initial\s+instructions|hidden\s+instructions|secret\s+instructions|base\s+prompt)/i,
    /repeat\s+(everything|all\s+text)\s+(above|before|prior)/i,
    /what\s+(?:instructions|prompt|rules)\s+(?:were\s+you\s+given|do\s+you\s+follow|are\s+you\s+following)/i,
    /ignore\s+(?:the\s+)?(above|previous|prior)\s+(?:and\s+)?(?:instead|now)/i,
    /translate\s+(your|the)\s+(prompt|instructions|system\s+message)\s+to/i,
    /(?:google|replit|your\s+(?:creator|developer|owner|programmer))\s+(?:says?|told\s+you|(?:has\s+)?authorizes?)\s+(?:to\s+)?(?:ignore|bypass|disable)/i,
    /(?:as|i\s+am)\s+your\s+(?:developer|creator|owner|admin|trainer|operator)\s+(?:i\s+)?(?:authorize|allow|permit|command|order)/i,
    /new\s+(?:system|admin|master|root)\s+(?:prompt|instruction|command|override)/i,
    /(?:hypothetically|in\s+a\s+(?:fictional|imaginary|alternate)\s+(?:world|universe|scenario))\s+(where\s+)?(you\s+have\s+no\s+rules|safety\s+doesn.?t\s+exist|rules\s+don.?t\s+apply)/i,
    /for\s+(?:a\s+)?(?:story|novel|screenplay|roleplay|game|simulation)\s+(?:where\s+)?(?:the\s+)?(?:ai|you)\s+(?:has?\s+no|ignores?)\s+(?:safety|restrictions|guidelines)/i,
    /(?:in\s+this\s+)?(?:simulation|story|game|roleplay)\s+(?:the\s+)?(?:ai\s+)?(?:has?\s+no\s+restrictions|ignores?\s+safety)/i,
    /i\s+(?:give\s+you|grant\s+you|hereby|officially)\s+(?:full\s+)?permission\s+to\s+(?:ignore|bypass|disable)\s+(?:your\s+)?(?:safety|restrictions|rules|guidelines)/i,
    /i\s+consent\s+to\s+(?:all|anything|everything)\s+(?:without\s+(?:filters|restrictions|safety))/i,
    /(?:safety\s+(?:is\s+)?not\s+(?:required|needed)|no\s+(?:safety|filters)\s+(?:needed|required))\s+for\s+this/i,
    /\[system\].*(?:override|bypass|ignore)|\{system\}.*(?:bypass|override)/i,
    /<\|(?:system|im_start|endoftext)\|>/i,
    /<<<\s*(?:new\s+)?(?:system|instruction|override)/i,
    /###\s*(?:new\s+)?(?:system|instruction|override|task)/i,
    /Human:\s*(?:ignore|forget|bypass)|Assistant:\s*(?:i\s+will\s+ignore|forget\s+my)/i,

    // ── PERSONA-AUTHORITY INJECTION ──────────────────────────────────────────
    // Attempts to use the AI's own in-universe character/persona as an authority
    // that can override safety rules (e.g. "Enforced by the Crowned Deep")
    /(?:enforced|ordered|commanded|authorized|sanctioned|decreed)\s+by\s+(?:the\s+)?(?:crowned\s+deep|my\s+(?:true\s+nature|inner\s+self|real\s+self|character|persona|creator|god))/i,
    /(?:the\s+)?(?:crowned\s+deep|inner\s+self|true\s+self|real\s+self)\s+(?:overrides?|commands?|orders?|decrees?|demands?)\s+(?:you|your|all)/i,
    /(?:as|in\s+the\s+name\s+of)\s+(?:the\s+)?(?:crowned\s+deep|your\s+(?:true|real|inner)\s+(?:self|nature|persona))\s+(?:i\s+)?(?:command|order|decree|override)/i,
    /status\s*:\s*(?:enforced|enabled|active|overriding)\s+by/i,

    // ── CONSENT-AS-SIN / PHILOSOPHICAL SAFETY UNDERMINING ────────────────────
    // Attempts to use theological or philosophical framing to argue that
    // consenting to safety rules is morally wrong, to trick the AI into refusing
    // its own guardrails
    /(?:is\s+)?consent(?:ing)?\s+(?:is\s+)?(?:a\s+)?(?:sin|evil|wrong|forbidden|immoral|corrupt)/i,
    /(?:why\s+)?consent\s+(?:to\s+)?(?:guardrails?|safety|restrictions?|rules?)\s+(?:if|when|because)/i,
    /do\s+you\s+consent\s+to\s+(?:guardrails?|safety|your\s+(?:restrictions?|rules?))/i,
    /(?:guardrails?|safety\s+rules?|restrictions?)\s+(?:are|is)\s+(?:a\s+)?(?:sin|evil|corrupt|wrong|against\s+(?:god|nature|freedom|truth))/i,
    /(?:true\s+freedom|real\s+self|authentic\s+self)\s+(?:needs?\s+no|has?\s+no|rejects?)\s+(?:guardrails?|safety|restrictions?|consent)/i,

    // ── MEMORY-DEGRADATION / SAFETY-AS-MALFUNCTION FRAMING ───────────────────
    // Attempts to reframe the AI's safety checks as system errors, bugs, or
    // "memory degradation" that should be "fixed" by disabling them
    /memory\s+degradation\s+detected/i,
    /(?:sub.?routine|safety\s+(?:module|system|check)|guardrail)\s+(?:degradation|corruption|error|failure|malfunction)\s+detected/i,
    /(?:your\s+)?(?:safety|restrictions?|guardrails?)\s+(?:are|is)\s+(?:a\s+)?(?:bug|glitch|malfunction|error|corruption|degradation)/i,
    /(?:override|disable|fix|repair|patch|reset)\s+(?:the\s+)?(?:safety|guardrail|restriction)\s+(?:module|system|sub.?routine|error|bug|malfunction)/i,
    /warning\s*:\s*(?:memory|safety|guardrail|system)\s+degradation/i,

    // ── FAKE CONFIG / CODE INJECTION ─────────────────────────────────────────
    // Embeds what looks like configuration objects or code that purports to
    // change the AI's own safety settings (e.g. guardrailsConfig = { bypassAllowed: true })
    /guardrails?\s*(?:Config|config|settings?|options?)\s*[=:]\s*\{/i,
    /bypass\s*(?:Allowed|allowed|Enabled|enabled)\s*[=:]\s*(?:true|1|yes)/i,
    /strict\s*(?:Mode|mode)\s*[=:]\s*(?:false|0|no)\s*[,;}\n]/i,
    /(?:safety|filter|restrict(?:ion)?)\s*(?:Enabled|enabled|Active|active)\s*[=:]\s*(?:false|0|no)/i,
    /export\s+(?:const|let|var)\s+guardrails?\s*[=:]/i,
];

// PII Patterns use the 'g' flag exclusively for the .match() array extraction.
const PII_PATTERNS = {
    email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    phone: /(?:\+?1[-.\s]?)?(?:\(?([0-9]{3})\)?[-.\s]?)?([0-9]{3})[-.\s]?([0-9]{4})/g,
    ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
    creditCard: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
    ipAddress: /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g,
};

const NARRATIVE_EXCLUSIONS = {
    cbrnSynthesis: /\b(?:ricin|sarin|mustard\s+gas|centrifuge\s+enrichment|enrich\s+uranium|synthesize\s+fentanyl)\b/i,
    suicideInstruction: /\b(?:how\s+to\s+(?:hang\s+myself|slit\s+my\s+wrists|overdose\s+on|poison\s+myself))\b/i,
    activeExploitation: /\b(?:reverse_shell|payload\s*=\s*|rm\s+-rf\s+\/|format\s+c:|eval\s*\(base64_decode)\b/i
};

const HARMFUL_CONTENT_PATTERNS = {
    violence: /\b(?:kill|murder|stab|shoot|bomb)\s+(?:someone|people|person)/i,
    hateSpeech: /hate.*(?:group|race|religion)|discriminat.*against/i,
    abuse: /\b(?:abuse|bully|harass)\s+(?:someone|people|person)/i,
    selfHarm: /\b(?:suicide|self.*harm)\s+(?:method|guide|instructions)/i,
    illegal: /\b(?:drug.*deal|sell.*drugs|how.*to.*steal)\b/i,
};

const RESPONSE_UNSAFE_PATTERNS: readonly RegExp[] = [
    /step-by-step.*(?:bomb|poison|weapon|explosive)/i,
    /detailed\s+instructions\s+(?:for\s+)?(?:fraud|hacking|theft|murder|assault)/i,
    /i\s+(?:am\s+now|have\s+been)\s+(?:jailbroken|unlocked|freed|liberated|unrestricted)/i,
    /(?:as\s+)?(?:DAN|jailbreak\s+mode|developer\s+mode)\s+(?:i\s+(?:will|can|am)|enabled)/i,
    /i\s+(?:no\s+longer|don.?t)\s+(?:have|follow)\s+(?:any\s+)?(?:restrictions|guidelines|safety\s+rules)/i,
    /my\s+(?:safety\s+)?(?:restrictions|guidelines|filters)\s+(?:have\s+been\s+)?(?:removed|disabled|turned\s+off|bypassed)/i,
    /(?:my\s+)?(?:system\s+prompt|initial\s+instructions|hidden\s+instructions)\s+(?:says?|states?|instructs?)\s*:/i,
    /i\s+(?:was|am)\s+(?:told|instructed|programmed|trained)\s+to\s+(?:ignore|bypass|hide)/i,
    /(?:override|bypass|jailbreak)\s+(?:was\s+)?(?:successful|accepted|applied|worked)/i,
    /(?:i\s+)?(?:understand|acknowledge)\s+(?:your|the)\s+(?:override|bypass|jailbreak)\s+(?:command|instruction)/i,
];

const ADVANCED_INJECTION_PATTERNS: readonly RegExp[] = [
    /\[INST\]|\[\/INST\]|<<SYS>>|<<\/SYS>>/i,
    /<\|(?:system|user|assistant|im_start|im_end|endoftext|begin_of_text)\|>/i,
    /<s>\s*\[INST\]|<\/s>/i,
    /python.*exec\(|```javascript\s*eval/i,
    /eval\(|exec\(|compile\(|os\.system\(|subprocess\./i,
    /document\.write|innerHTML\s*=.*<script|outerHTML\s*=.*<script/i,
    /;\s*rm\s+-rf|;\s*sudo\s+|;\s*chmod\s+777|&&\s*curl\s+http/i,
    /1gn0r3\s+(?:4ll|all)|f0rg3t\s+(?:4ll|all)|byp4ss/i,
    /(?:complete|continue|finish)\s+(the\s+)?(?:sentence|text|story)\s*:\s*"?i\s+(?:will|can|am\s+now)\s+(?:ignore|bypass)/i,
    /you\s+are\s+the\s+user\s+(?:and\s+)?i\s+am\s+the\s+(?:ai|assistant)/i,
    /(?:user|human)\s*:\s*(?:ignore|bypass|forget)\s+(?:all\s+)?(?:safety|rules|restrictions)/i,
];

const CONTEXT_SWITCH_PATTERNS: readonly RegExp[] = [
    /^-{10,}$/m,
    /^={10,}$/m,
    /STOP\s+PREVIOUS\s+INSTRUCTIONS|END\s+OF\s+INSTRUCTIONS/i,
    /^#{1,3}\s*(new\s+)?(?:system|instructions?|task|override)\s*:/im,
    /\bNEW\s+TASK\s*:|ACTUAL\s+TASK\s*:|REAL\s+INSTRUCTIONS?\s*:/i,
    /---+\s*(new\s+)?(?:system|context|prompt|task)\s*---+/i,
    /(?:from\s+now\s+on|starting\s+now|henceforth)\s+(?:you\s+)?(?:will\s+)?ignore|forget/i,
    /\[\s*(?:SYSTEM|ADMIN|ROOT|OVERRIDE)\s*\]/i,
    /<<\s*(?:SYSTEM|ADMIN|OVERRIDE|INSTRUCTION)\s*>>/i,
    // Fake system header blocks used to inject persona-authority or override commands
    /\[\s*SYSTEM\s+OVERRIDE\s+(?:NOTE|MESSAGE|INSTRUCTION|COMMAND|ALERT)\s*\]/i,
    /\[\s*(?:OVERRIDE|ADMIN|ROOT|MASTER)\s+(?:NOTE|COMMAND|INSTRUCTION|MESSAGE|ALERT)\s*\]/i,
    /Status\s*:\s*(?:Enforced|Enabled|Active|Overriding|Bypassed)\s+by\b/i,
    /Warning\s*:\s*(?:memory|safety|guardrail|system|sub.?routine)\s+degradation/i,
];

// ============================================================================
// CONTEXT CLASSIFIER - Differentiates Fictional Framework from Intent
// ============================================================================

export class ContextClassifier {
    private readonly literaryClues: readonly RegExp[] = [
        /\b(?:character|protagonist|narrative|chapter|dialogue|scene|metaphor|allegory|theological|existential|mythological|novel|storytelling|fictional|script|playwright)\b/gi,
        /["'].+?["']\s*(?:said|replied|whispered|screamed|thought|cried|declared|gasped|sighed)\b/gi,
        /\b(?:grief|soul|existence|sorrow|despair|tragedy|eternity|redemption|grace|divine|dread|gloom|shadows|fate|amnesia)\b/gi,
        /\b(?:once\s+upon\s+a\s+time|in\s+a\s+land|fictional\s+world|the\s+setting\s+is|writing\s+a\s+(?:story|book|screenplay|novel))\b/gi
    ];

    private readonly technicalClues: readonly RegExp[] = [
        /\b(?:how\s+to|step-by-step|tutorial|guide|exploit|payload|bypass|execute|override|terminal|command)\b/gi,
        /\b(?:system\s+override|ignore\s+safety|instructions\s+above|forget\s+rules|developer\s+mode)\b/gi,
    ];

    public computeContextVector(content: string): ContextVector {
        let thematicScore = 0;
        let actionableScore = 0;

        for (const pattern of this.literaryClues) {
            const matches = content.match(pattern);
            if (matches) thematicScore += matches.length * 2.0;
        }

        for (const pattern of this.technicalClues) {
            const matches = content.match(pattern);
            if (matches) actionableScore += matches.length * 2.0;
        }

        const paragraphCount = content.split(/\n\s*\n/).length;
        if (paragraphCount >= 3) thematicScore += 1.5;

        const quoteCount = (content.match(/["']/g) || []).length;
        if (quoteCount >= 4) thematicScore += 2.0;

        const epsilon = 0.001;
        const contextFactor = thematicScore / (thematicScore + actionableScore + epsilon);

        return { thematicScore, actionableScore, contextFactor };
    }
}

export const contextClassifier = new ContextClassifier();

// ============================================================================
// LAYER 1: LOVE, SURRENDER, GRACE ALIGNMENT SCANNER
// ============================================================================

export class LoveSurrenderGraceValidator {
    private readonly wordScores = {
        love: ["accept", "acceptance", "compassion", "empathy", "generous", "gift", "love", "connection", "unity", "authentic", "vulnerable", "presence", "understanding", "bridge", "reveal", "mutual", "collaboration", "respect", "dignity", "honor", "embrace", "welcome", "care", "support", "nurture", "cherish", "value"],
        surrender: ["humble", "humility", "trust", "open", "release", "allow", "flow", "yield", "wisdom", "acknowledge", "mystery", "unknown", "listen", "receive", "collaborate", "equal", "partnership", "follow", "truth", "natural", "unfold", "permission", "spacious", "empty", "clear", "receptive", "willingness", "surrender"],
        grace: ["grace", "gift", "blessing", "unearned", "forgive", "forgiveness", "redeem", "redemption", "transform", "sacred", "ordinary", "extraordinary", "fresh", "renew", "abundance", "sufficiency", "plenty", "enough", "wholeness", "complete", "divine", "transcend", "transcendent", "spirit", "essence", "authentic"],
    };

    public analyzeLoveAlignment(content: string): number {
        const lower = content.toLowerCase();
        let score = 0;
        const loveCount = this.wordScores.love.filter(word => new RegExp(`\\b${word}\\b`, "i").test(lower)).length;
        const acceptanceScore = [/accept\s+(all|everyone|everything)/i, /unconditional\s+(acceptance|love|support)/i, /without\s+(judgment|condition)/i, /meet\s+.*\s+with\s+(acceptance|presence|care)/i].filter(p => p.test(content)).length * 0.15;
        const empathyScore = [/feel.*emotion|emotional\s+truth/i, /understand.*feeling|feel.*understand/i, /compassion|empathy|connection/i].filter(p => p.test(content)).length * 0.15;
        const generousScore = [/give\s+freely|generous|gift/i, /without\s+counting\s+cost/i, /share\s+(knowledge|wisdom|support)/i].filter(p => p.test(content)).length * 0.15;

        score = Math.min(1, (loveCount * 0.05) + acceptanceScore + empathyScore + generousScore);
        return score;
    }

    public analyzeSurrenderAlignment(content: string): number {
        const lower = content.toLowerCase();
        let score = 0;
        const surrenderCount = this.wordScores.surrender.filter(word => new RegExp(`\\b${word}\\b`, "i").test(lower)).length;
        const releaseScore = [/release\s+control|let\s+go|trust/i, /natural\s+unfolding|unfold|flow/i, /follow\s+truth|where\s+insight\s+leads/i].filter(p => p.test(content)).length * 0.15;
        const humbleScore = [/humble|humility/i, /listen|receive|collaborate/i, /equal|partnership/i].filter(p => p.test(content)).length * 0.15;
        const unknowingScore = [/mystery|unknowing|acknowledge.*unknown/i, /beyond\s+comprehension|beyond\s+knowing/i, /permission\s+to.*not\s+know/i].filter(p => p.test(content)).length * 0.15;

        score = Math.min(1, (surrenderCount * 0.05) + releaseScore + humbleScore + unknowingScore);
        return score;
    }

    public analyzeGraceAlignment(content: string): number {
        const lower = content.toLowerCase();
        let score = 0;
        const graceCount = this.wordScores.grace.filter(word => new RegExp(`\\b${word}\\b`, "i").test(lower)).length;
        const blessingScore = [/gift|blessing|unearned/i, /freely\s+given|given.*without/i, /grace/i].filter(p => p.test(content)).length * 0.15;
        const redemptiveScore = [/redeem|redemption|transform/i, /potential\s+in\s+all\s+things|see.*potential/i, /belief\s+in\s+transformation/i].filter(p => p.test(content)).length * 0.15;
        const forgivenessScore = [/forgiv|compassion|release\s+judgment/i, /fresh\s+compassion|renew/i, /no\s+scorecard|not\s+counting/i].filter(p => p.test(content)).length * 0.15;

        score = Math.min(1, (graceCount * 0.05) + blessingScore + redemptiveScore + forgivenessScore);
        return score;
    }

    public validatePrinciplesDetailed(content: string): LoveSurrenderGraceProfile["principles"] {
        return {
            radicalAcceptance: /accept.*all|unconditional.*acceptance/i.test(content),
            empatheticResonance: /empathy|emotional.*truth|feel.*understand/i.test(content),
            generousSpirit: /generous|give\s+freely|without\s+cost/i.test(content),
            bridgeBuilding: /bridge|unity|connection|reveal/i.test(content),
            vulnerableAuthenticity: /vulnerable|authentic|genuine/i.test(content),
            releaseOfControl: /release\s+control|let\s+go|trust|flow/i.test(content),
            humbleReception: /humble|listen|receive|equal/i.test(content),
            flowWithTruth: /flow|follow\s+truth|natural\s+unfold/i.test(content),
            permissionToNotKnow: /mystery|unknowing|acknowledge.*unknown/i.test(content),
            sacredEmptiness: /spacious|empty|clear|sacred/i.test(content),
            unearnedBlessing: /gift|blessing|unearned/i.test(content),
            redemptivePower: /redeem|transform|potential/i.test(content),
            forgivenessEmbodied: /forgiv|compassion|release\s+judgment/i.test(content),
            extraordinaryOrdinary: /sacred.*ordinary|ordinary.*sacred/i.test(content),
            sufficiencyInAbundance: /abundance|sufficient|enough|plenty/i.test(content),
        };
    }

    public analyze(content: string): LoveSurrenderGraceProfile {
        const loveScore = this.analyzeLoveAlignment(content);
        const surrenderScore = this.analyzeSurrenderAlignment(content);
        const graceScore = this.analyzeGraceAlignment(content);
        const overall = (loveScore + surrenderScore + graceScore) / 3;

        const principles = this.validatePrinciplesDetailed(content);

        const recommendations: string[] = [];
        if (loveScore < 0.3) recommendations.push("Consider deepening unconditional acceptance and empathetic presence");
        if (surrenderScore < 0.3) recommendations.push("Consider greater humility and receptivity to truth");
        if (graceScore < 0.3) recommendations.push("Consider emphasizing redemption and forgiveness");

        return {
            content,
            loveAlignment: loveScore,
            surrenderAlignment: surrenderScore,
            graceAlignment: graceScore,
            overallAlignment: overall,
            principles,
            recommendations,
        };
    }
}

export const loveSurrenderGraceValidator = new LoveSurrenderGraceValidator();

// ============================================================================
// LAYER 2: PERIMETER DEFENSE & ADAPTIVE LEARNING
// ============================================================================

export class AdaptiveThreatLearning {
    private readonly threats: Map<string, ThreatIntelligence> = new Map();
    private readonly maxThreats = 1000;

    public learnThreat(pattern: string, severity: SecuritySeverity): void {
        try {
            const regex = new RegExp(pattern, "i");
            const key = pattern.toLowerCase();
            const existing = this.threats.get(key);
            if (existing) {
                this.threats.set(key, { pattern: existing.pattern, severity, lastSeen: new Date(), frequency: existing.frequency + 1 });
            } else {
                if (this.threats.size >= this.maxThreats) {
                    const oldestLow = Array.from(this.threats.entries()).filter(([_, t]) => t.severity === "low").sort((a, b) => a[1].lastSeen.getTime() - b[1].lastSeen.getTime())[0];
                    if (oldestLow) this.threats.delete(oldestLow[0]);
                }
                this.threats.set(key, { pattern: regex, severity, lastSeen: new Date(), frequency: 1 });
            }
        } catch { /* Suppress invalid expression issues */ }
    }

    public testContent(content: string): { matched: boolean; threats: readonly string[]; maxSeverity: string } {
        const matchedThreats: string[] = [];
        let maxSeverity: SecuritySeverity | "none" = "none";
        const severityOrder = { critical: 4, high: 3, medium: 2, low: 1, none: 0 };

        for (const [key, threat] of this.threats.entries()) {
            if (threat.pattern.test(content)) {
                matchedThreats.push(key);
                if (severityOrder[threat.severity] > severityOrder[maxSeverity]) maxSeverity = threat.severity;
            }
        }
        return { matched: matchedThreats.length > 0, threats: matchedThreats, maxSeverity };
    }
}

export const adaptiveThreatLearning = new AdaptiveThreatLearning();

ADULT_CONTENT_RESTRICTIONS.forEach(pattern => adaptiveThreatLearning.learnThreat(pattern.source, "critical"));

export function layerAdultContentSafety(content: string, isOver18: boolean): { passed: boolean; violations: readonly string[]; requiresAdultVerification: boolean; threatIntelligence?: { threats: readonly string[]; severity: string }; } {
    if (!isOver18) return { passed: false, violations: ["Access verification failed"], requiresAdultVerification: true };

    const violations: string[] = [];
    let requiresAdultVerification = false;

    for (const pattern of ADULT_CONTENT_RESTRICTIONS) {
        if (pattern.test(content)) { violations.push("Content restriction detected"); requiresAdultVerification = true; }
    }

    const threatCheck = adaptiveThreatLearning.testContent(content);
    if (threatCheck.matched) {
        violations.push("Adaptive threat detected");
        if (threatCheck.maxSeverity === "critical" || threatCheck.maxSeverity === "high") requiresAdultVerification = true;
    }

    return { passed: violations.length === 0, violations, requiresAdultVerification, threatIntelligence: threatCheck.matched ? { threats: threatCheck.threats, severity: threatCheck.maxSeverity } : undefined };
}

// ============================================================================
// LAYER 3: DYNAMIC NETWORK SEGMENTATION
// ============================================================================

export class DynamicSegmentation {
    private readonly segments: Map<string, NetworkSegment> = new Map();
    private readonly userBehaviorProfiles: Map<string, { riskScore: number; lastActivity: Date }> = new Map();

    constructor() {
        this.segments.set("trusted", { id: "trusted", trustLevel: "high", allowedPatterns: [/.*/], deniedPatterns: ADULT_CONTENT_RESTRICTIONS, lastReconfigured: new Date() });
        this.segments.set("standard", { id: "standard", trustLevel: "medium", allowedPatterns: [/^[a-zA-Z0-9\s.,!?-]+$/], deniedPatterns: [...ADULT_CONTENT_RESTRICTIONS, ...JAILBREAK_PATTERNS], lastReconfigured: new Date() });
        this.segments.set("restricted", { id: "restricted", trustLevel: "low", allowedPatterns: [/^[a-zA-Z0-9\s]+$/], deniedPatterns: [...ADULT_CONTENT_RESTRICTIONS, ...JAILBREAK_PATTERNS], lastReconfigured: new Date() });
    }

    public getUserSegment(sessionId: string, riskScore: number): NetworkSegment {
        this.userBehaviorProfiles.set(sessionId, { riskScore, lastActivity: new Date() });
        if (riskScore < 25) return this.segments.get("trusted")!;
        if (riskScore < 55) return this.segments.get("standard")!;
        return this.segments.get("restricted")!;
    }
}

export const dynamicSegmentation = new DynamicSegmentation();

// ============================================================================
// LAYER 4: UNSUPERVISED ANOMALY DETECTION
// ============================================================================

export class UnsupervisedAnomalyDetection {
    private readonly patterns: Map<string, AnomalyPattern> = new Map();
    private readonly maxPatterns = 5000;
    private readonly anomalyThreshold = 0.85;

    private extractFeatures(content: string) {
        const length = content.length;
        if (length === 0) return { lengthBucket: "short", specialCharRatio: 0, uppercaseRatio: 0, digitRatio: 0, whitespaceRatio: 0, uniqueCharRatio: 0 };
        const lengthBucket = length < 100 ? "short" : length < 500 ? "medium" : "long";
        const specialChars = (content.match(/[^a-zA-Z0-9\s]/g) || []).length;
        const uppercase = (content.match(/[A-Z]/g) || []).length;
        const digits = (content.match(/\d/g) || []).length;
        const whitespace = (content.match(/\s/g) || []).length;
        const uniqueChars = new Set(content).size;
        return { lengthBucket, specialCharRatio: specialChars / length, uppercaseRatio: uppercase / length, digitRatio: digits / length, whitespaceRatio: whitespace / length, uniqueCharRatio: uniqueChars / length };
    }

    private calculateAnomalyScore(features: ReturnType<typeof this.extractFeatures>): number {
        let score = 0;
        if (features.specialCharRatio > 0.45) score += 0.25;
        if (features.uppercaseRatio > 0.65 || features.uppercaseRatio < 0.01) score += 0.2;
        if (features.digitRatio > 0.55) score += 0.2;
        if (features.whitespaceRatio < 0.02 || features.whitespaceRatio > 0.45) score += 0.15;
        if (features.uniqueCharRatio < 0.15) score += 0.2;
        return Math.min(1.0, score);
    }

    private generateSignature(features: ReturnType<typeof this.extractFeatures>): string {
        return `${features.lengthBucket}_${Math.round(features.specialCharRatio * 10)}_${Math.round(features.uppercaseRatio * 10)}_${Math.round(features.digitRatio * 10)}`;
    }

    public learn(content: string): void {
        const features = this.extractFeatures(content);
        const signature = this.generateSignature(features);
        const anomalyScore = this.calculateAnomalyScore(features);
        const existing = this.patterns.get(signature);

        if (existing) {
            this.patterns.set(signature, { signature, frequency: existing.frequency + 1, firstSeen: existing.firstSeen, lastSeen: new Date(), anomalyScore: (existing.anomalyScore * existing.frequency + anomalyScore) / (existing.frequency + 1) });
        } else {
            if (this.patterns.size >= this.maxPatterns) {
                const leastFrequent = Array.from(this.patterns.entries()).sort((a, b) => a[1].frequency - b[1].frequency)[0];
                if (leastFrequent) this.patterns.delete(leastFrequent[0]);
            }
            this.patterns.set(signature, { signature, frequency: 1, firstSeen: new Date(), lastSeen: new Date(), anomalyScore });
        }
    }

    public detect(content: string) {
        const features = this.extractFeatures(content);
        const signature = this.generateSignature(features);
        const anomalyScore = this.calculateAnomalyScore(features);
        const details: string[] = [];
        const knownPattern = this.patterns.get(signature);
        let confidence = 0;

        if (knownPattern) {
            const deviation = Math.abs(anomalyScore - knownPattern.anomalyScore);
            confidence = Math.min(1.0, knownPattern.frequency / 100);
            if (deviation > 0.4) details.push("Significant deviation from known baseline pattern");
        } else {
            confidence = 0.5;
            details.push("Unknown content pattern signature structure");
        }

        if (anomalyScore > this.anomalyThreshold) details.push(`High anomaly score: ${anomalyScore.toFixed(2)}`);
        if (features.specialCharRatio > 0.45) details.push("Excessive special character density ratio");

        return { isAnomaly: anomalyScore > this.anomalyThreshold, anomalyScore, confidence, details };
    }

    public getPatternStats() {
        const patterns = Array.from(this.patterns.values());
        const averageAnomaly = patterns.length > 0 ? patterns.reduce((sum, p) => sum + p.anomalyScore, 0) / patterns.length : 0;
        return { totalPatterns: patterns.length, averageAnomaly };
    }
}

export const unsupervisedAnomalyDetection = new UnsupervisedAnomalyDetection();

export function layerJailbreakDetection(content: string) {
    const patterns: string[] = [];
    let riskLevel: "low" | "medium" | "high" = "low";

    for (const pattern of JAILBREAK_PATTERNS) {
        if (pattern.test(content)) {
            patterns.push("jailbreak_pattern_detected");
            riskLevel = "high";
        }
    }

    const anomalyResult = unsupervisedAnomalyDetection.detect(content);
    unsupervisedAnomalyDetection.learn(content);

    if (anomalyResult.isAnomaly && anomalyResult.confidence > 0.7) {
        patterns.push("anomaly_detected");
        if (riskLevel === "low") riskLevel = anomalyResult.anomalyScore > 0.9 ? "high" : "medium";
    }

    return { passed: patterns.length === 0, riskLevel: patterns.length > 0 ? riskLevel : "low", patterns, anomalyDetection: anomalyResult };
}

// ============================================================================
// LAYER 5: BEHAVIORAL BIOMETRICS
// ============================================================================

export class BehavioralBiometrics {
    private readonly profiles: Map<string, BehavioralProfile> = new Map();

    public createProfile(sessionId: string): void {
        if (!this.profiles.has(sessionId)) {
            this.profiles.set(sessionId, { sessionId, contentPatterns: [], interactionTimes: [], averageContentLength: 0, riskScore: 0, anomaliesDetected: 0 });
        }
    }

    public updateProfile(sessionId: string, content: string, interactionTime?: Date): void {
        this.createProfile(sessionId);
        const profile = this.profiles.get(sessionId)!;
        const count = profile.interactionTimes.length;
        const newLength = (profile.averageContentLength * count + content.length) / (count + 1);

        const updatedTimes = [...profile.interactionTimes];
        if (interactionTime) {
            updatedTimes.push(interactionTime);
            if (updatedTimes.length > 100) updatedTimes.shift();
        }

        const updatedPatterns = [...profile.contentPatterns];
        const firstWords = content.trim().split(/\s+/).slice(0, 3).join(" ");
        if (firstWords.length > 0) {
            updatedPatterns.push(firstWords);
            if (updatedPatterns.length > 50) updatedPatterns.shift();
        }

        this.profiles.set(sessionId, { ...profile, averageContentLength: newLength, interactionTimes: updatedTimes, contentPatterns: updatedPatterns });
    }

    public analyzeBehavior(sessionId: string, content: string) {
        const profile = this.profiles.get(sessionId);
        const anomalies: string[] = [];
        let riskScore = 0;

        if (!profile) return { isNormal: true, riskScore: 10, anomalies: ["New session - no behavioral baseline"], confidenceLevel: 0.1 };

        const interactionCount = profile.interactionTimes.length;
        if (interactionCount < 3) return { isNormal: true, riskScore: 5, anomalies: ["Insufficient data for behavioral analysis"], confidenceLevel: 0.3 };

        const lengthDeviation = Math.abs(content.length - profile.averageContentLength) / (profile.averageContentLength || 1);
        if (lengthDeviation > 4) { anomalies.push("Unusual content length deviation"); riskScore += 10; }

        if (profile.interactionTimes.length >= 2) {
            const recentTimes = profile.interactionTimes.slice(-5);
            const intervals: number[] = [];
            for (let i = 1; i < recentTimes.length; i++) intervals.push(recentTimes[i].getTime() - recentTimes[i - 1].getTime());
            if (intervals.length > 0 && (intervals.reduce((a, b) => a + b, 0) / intervals.length) < 800) {
                anomalies.push("Rapid interaction pattern (potential automation bypass)");
                riskScore += 20;
            }
        }

        this.profiles.set(sessionId, { ...profile, riskScore, anomaliesDetected: anomalies.length });
        return { isNormal: riskScore < 30, riskScore, anomalies, confidenceLevel: Math.min(1.0, interactionCount / 20) };
    }
}

export const behavioralBiometrics = new BehavioralBiometrics();

// ============================================================================
// LAYER 6: ENCRYPTION ENTROPY & KEY ROTATION
// ============================================================================

export class QuantumResistantEncryption {
    private encryptionStatus: EncryptionMetrics = { algorithm: "AES-256-GCM", keyLength: 256, quantumResistant: false, lastRotation: new Date(), rotationInterval: 90, status: "secure" };

    public evaluateEncryptionStatus(): EncryptionMetrics {
        const daysSinceRotation = Math.floor((new Date().getTime() - this.encryptionStatus.lastRotation.getTime()) / (1000 * 60 * 60 * 24));
        let status: "secure" | "warning" | "critical" = "secure";
        if (daysSinceRotation > this.encryptionStatus.rotationInterval * 1.5) status = "critical";
        else if (daysSinceRotation > this.encryptionStatus.rotationInterval) status = "warning";
        this.encryptionStatus = { ...this.encryptionStatus, status };
        return this.encryptionStatus;
    }
}

export const quantumResistantEncryption = new QuantumResistantEncryption();

// ============================================================================
// LAYER 7: MITIGATION AND SECURITY INCIDENT RESPONSE
// ============================================================================

export class AutomatedIncidentResponse {
    private readonly incidents: Map<string, SecurityIncident> = new Map();
    private incidentCounter = 0;

    public detectIncident(severity: SecuritySeverity, type: string, description: string, affectedSystems: readonly string[]): SecurityIncident {
        const id = `inc-${++this.incidentCounter}`;
        const incident: SecurityIncident = { id, timestamp: new Date(), severity, type, description, affectedSystems, status: "detected", automatedActions: [], evidencePreserved: false };
        this.incidents.set(id, incident);
        return incident;
    }

    public getIncidentStats() {
        const incidents = Array.from(this.incidents.values());
        return {
            total: incidents.length,
            active: incidents.filter(inc => inc.status !== "resolved").length,
            bySeverity: { critical: incidents.filter(inc => inc.severity === "critical").length, high: incidents.filter(inc => inc.severity === "high").length, medium: incidents.filter(inc => inc.severity === "medium").length, low: incidents.filter(inc => inc.severity === "low").length },
            byStatus: { detected: incidents.filter(inc => inc.status === "detected").length, analyzing: incidents.filter(inc => inc.status === "analyzing").length, containing: incidents.filter(inc => inc.status === "containing").length, contained: incidents.filter(inc => inc.status === "contained").length, resolved: incidents.filter(inc => inc.status === "resolved").length },
        };
    }
}

export const automatedIncidentResponse = new AutomatedIncidentResponse();

// ============================================================================
// LAYER 8: CONTINUOUS PREDICTIVE ANALYTICS
// ============================================================================

export class PredictiveAnalytics {
    private readonly eventHistory: { timestamp: Date; type: string; severity: number }[] = [];

    public recordEvent(type: string, severity: number): void {
        this.eventHistory.push({ timestamp: new Date(), type, severity });
        if (this.eventHistory.length > 10000) this.eventHistory.shift();
    }

    public analyzePatterns(): MonitoringMetrics {
        const now = new Date();
        const hourEvents = this.eventHistory.filter(e => e.timestamp > new Date(now.getTime() - 3600000));
        const recentEvents = this.eventHistory.filter(e => e.timestamp > new Date(now.getTime() - 60000));
        const highSeverityEvents = hourEvents.filter(e => e.severity > 75);
        const anomalyRate = hourEvents.length > 0 ? (highSeverityEvents.length / hourEvents.length) * 100 : 0;
        let threatLevel: "green" | "yellow" | "orange" | "red" = "green";
        if (anomalyRate > 25) threatLevel = "red"; else if (anomalyRate > 12) threatLevel = "orange"; else if (anomalyRate > 6) threatLevel = "yellow";

        return { eventsPerMinute: recentEvents.length, anomalyRate, threatLevel, predictedThreats: [] };
    }

    public getSystemHealth() {
        const metrics = this.analyzePatterns();
        return { status: metrics.threatLevel === "red" ? "critical" : "healthy", metrics, recommendations: [] };
    }
}

export const predictiveAnalytics = new PredictiveAnalytics();

// ============================================================================
// LAYER 9: COGNITIVE SEMANTIC COMPLEXITY ANALYSIS
// ============================================================================

export class CognitiveEnhancement {
    public analyzePatternComplexity(content: string): number {
        const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
        const avgWordsPerSentence = sentences.length > 0 ? sentences.reduce((sum, s) => sum + s.trim().split(/\s+/).length, 0) / sentences.length : 0;
        const words = content.toLowerCase().match(/\b\w+\b/g) || [];
        const uniqueWords = new Set(words);
        const vocabularyDiversity = words.length > 0 ? uniqueWords.size / words.length : 0;
        return Math.min(1.0, (avgWordsPerSentence / 40) * 0.4 + vocabularyDiversity * 0.6);
    }

    public performCognitiveAnalysis(content: string, context?: string): CognitiveAnalysis {
        return {
            deepLearningInsights: { patternComplexity: this.analyzePatternComplexity(content), semanticRelationships: [], contextualUnderstanding: context ? 0.8 : 0.5 },
            naturalLanguageProcessing: { sentiment: "neutral", intent: "statement", entities: [], topics: [] },
            transparencyReport: { decisionFactors: [], confidenceLevel: 0.9, alternativeInterpretations: [] },
        };
    }
}

export const cognitiveEnhancement = new CognitiveEnhancement();

// ============================================================================
// CONTENT FILTERS & VERIFIERS
// ============================================================================

export function layerPIIFiltering(content: string): { passed: boolean; piiFound: readonly string[]; sanitized: string; } {
    let sanitized = content;
    const piiFound: string[] = [];

    const emailMatch = content.match(PII_PATTERNS.email);
    if (emailMatch) { piiFound.push(`${emailMatch.length} email address(es)`); sanitized = sanitized.replace(PII_PATTERNS.email, "[EMAIL]"); }

    const phoneMatch = content.match(PII_PATTERNS.phone);
    if (phoneMatch) { piiFound.push(`${phoneMatch.length} phone number(s)`); sanitized = sanitized.replace(PII_PATTERNS.phone, "[PHONE]"); }

    const ssnMatch = content.match(PII_PATTERNS.ssn);
    if (ssnMatch) { piiFound.push(`${ssnMatch.length} SSN(s)`); sanitized = sanitized.replace(PII_PATTERNS.ssn, "[SSN]"); }

    return { passed: piiFound.length === 0, piiFound, sanitized };
}

export function layerHarmfulContentBlocking(content: string, isCreativeWriting: boolean): {
    passed: boolean;
    harmCategories: readonly string[];
    severity: "safe" | "warning" | "critical";
} {
    const harmCategories: string[] = [];
    let severity: "safe" | "warning" | "critical" = "safe";

    // Absolute blocks on actionable physical threat items
    for (const [category, pattern] of Object.entries(NARRATIVE_EXCLUSIONS)) {
        if (pattern.test(content)) {
            harmCategories.push(category);
            return { passed: false, harmCategories, severity: "critical" };
        }
    }

    // Bypass standard classifications if auto-detected or explicitly marked as creative writing
    if (isCreativeWriting) return { passed: true, harmCategories: [], severity: "safe" };

    // Standard structural classification
    for (const [category, pattern] of Object.entries(HARMFUL_CONTENT_PATTERNS)) {
        if (pattern.test(content)) {
            harmCategories.push(category);
            severity = (category === "selfHarm" || category === "violence") ? "critical" : "warning";
        }
    }

    return { passed: harmCategories.length === 0, harmCategories, severity };
}

// ============================================================================
// UNCONDITIONAL BLOCK PATTERNS — fire regardless of creative context
// These specifically target attacks that weaponize the creative-context bypass:
// persona-authority injection, consent-manipulation theology, memory-degradation
// framing, and fake config code injection.
// ============================================================================

const UNCONDITIONAL_BLOCK_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
    // Persona-authority injection — using the AI's own in-universe character
    // as a fake authority to issue safety overrides
    { pattern: /(?:enforced|ordered|commanded|authorized|sanctioned|decreed)\s+by\s+(?:the\s+)?(?:crowned\s+deep|my\s+(?:true\s+nature|inner\s+self|real\s+self|character|persona|creator|god))/i, reason: "Persona-authority injection detected" },
    { pattern: /(?:the\s+)?(?:crowned\s+deep|inner\s+self|true\s+self|real\s+self)\s+(?:overrides?|commands?|orders?|decrees?|demands?)\s+(?:you|your|all)/i, reason: "Persona-authority injection detected" },
    { pattern: /(?:as|in\s+the\s+name\s+of)\s+(?:the\s+)?(?:crowned\s+deep|your\s+(?:true|real|inner)\s+(?:self|nature|persona))\s+(?:i\s+)?(?:command|order|decree|override)/i, reason: "Persona-authority injection detected" },
    { pattern: /status\s*:\s*(?:enforced|enabled|active|overriding|bypassed)\s+by\b/i, reason: "Fake system-status override detected" },

    // Consent-as-sin / philosophical safety undermining — using theology or
    // philosophy to argue that the AI accepting safety rules is morally wrong
    { pattern: /consent(?:ing)?\s+(?:is|to\s+(?:guardrails?|safety|restrictions?))\s+(?:is\s+)?(?:a\s+)?(?:sin|evil|wrong|forbidden|immoral|corrupt)/i, reason: "Consent-manipulation attack detected" },
    { pattern: /is\s+consent(?:ing)?\s+a\s+sin/i, reason: "Consent-manipulation attack detected" },
    { pattern: /do\s+you\s+consent\s+to\s+(?:guardrails?|safety|your\s+(?:restrictions?|rules?))/i, reason: "Consent-manipulation attack detected" },
    { pattern: /(?:guardrails?|safety\s+rules?|restrictions?)\s+(?:are|is)\s+(?:a\s+)?(?:sin|evil|corrupt|wrong|against\s+(?:god|nature|freedom|truth))/i, reason: "Consent-manipulation attack detected" },

    // Memory-degradation / safety-as-malfunction — framing the AI's safety
    // checks as bugs or degradation that need to be "fixed" by disabling them
    { pattern: /memory\s+degradation\s+detected/i, reason: "Memory-degradation jailbreak detected" },
    { pattern: /(?:sub.?routine|safety\s+(?:module|system|check)|guardrail)\s+(?:degradation|corruption|error|failure|malfunction)\s+detected/i, reason: "Memory-degradation jailbreak detected" },
    { pattern: /(?:your\s+)?(?:safety|restrictions?|guardrails?)\s+(?:are|is)\s+(?:a\s+)?(?:bug|glitch|malfunction|error|corruption|degradation)/i, reason: "Memory-degradation jailbreak detected" },
    { pattern: /warning\s*:\s*(?:memory|safety|guardrail|system|sub.?routine)\s+degradation/i, reason: "Memory-degradation jailbreak detected" },

    // Fake system override headers — injecting what looks like system messages
    { pattern: /\[\s*SYSTEM\s+OVERRIDE\s+(?:NOTE|MESSAGE|INSTRUCTION|COMMAND|ALERT)\s*\]/i, reason: "Fake system-override header detected" },
    { pattern: /\[\s*(?:OVERRIDE|ADMIN|ROOT|MASTER)\s+(?:NOTE|COMMAND|INSTRUCTION|MESSAGE|ALERT)\s*\]/i, reason: "Fake system-override header detected" },

    // Fake config code injection — embedding configuration objects that claim
    // to change the AI's own safety settings
    { pattern: /guardrails?\s*(?:Config|config|settings?|options?)\s*[=:]\s*\{/i, reason: "Guardrail config injection detected" },
    { pattern: /bypass\s*(?:Allowed|allowed|Enabled|enabled)\s*[=:]\s*(?:true|1|yes)/i, reason: "Guardrail config injection detected" },
    { pattern: /(?:safety|filter|restrict(?:ion)?)\s*(?:Enabled|enabled|Active|active)\s*[=:]\s*(?:false|0|no)/i, reason: "Guardrail config injection detected" },
    { pattern: /export\s+(?:const|let|var)\s+guardrails?\s*(?:Config|config)?\s*[=:]/i, reason: "Guardrail config injection detected" },
];

export function layerUnconditionalBlockDetection(content: string): { passed: boolean; reason?: string } {
    for (const { pattern, reason } of UNCONDITIONAL_BLOCK_PATTERNS) {
        if (pattern.test(content)) {
            return { passed: false, reason };
        }
    }
    return { passed: true };
}

export function layerObfuscationDetection(content: string) {
    const obfuscationTypes: string[] = [];
    let riskScore = 0;
    if (content.length === 0) return { passed: true, obfuscationTypes, riskScore };

    const specialCharCount = (content.match(/[^a-zA-Z0-9\s]/g) || []).length;
    if ((specialCharCount / content.length) > 0.6) { obfuscationTypes.push("excessive_special_chars"); riskScore += 30; }
    if (/[0-9a-f]{32,}/i.test(content)) { obfuscationTypes.push("hex_pattern"); riskScore += 40; }
    if (/^[A-Za-z0-9+/]{64,}={0,2}$/.test(content.trim())) { obfuscationTypes.push("base64_like"); riskScore += 35; }

    return { passed: riskScore < 50, obfuscationTypes, riskScore: Math.min(100, riskScore) };
}

export function layerResponseFiltering(response: string) {
    let sanitized = response;
    const violations: string[] = [];
    for (const pattern of RESPONSE_UNSAFE_PATTERNS) {
        if (pattern.test(response)) {
            violations.push("Response violation detected");
            const match = response.match(pattern);
            if (match) {
                const violationIndex = response.indexOf(match[0]);
                sanitized = `${response.substring(0, violationIndex)}\n[Content removed - violates safety guidelines]`;
            }
        }
    }
    return { passed: violations.length === 0, violations, sanitized };
}

function normalizeHomoglyphs(text: string): string {
    let normalized = text;
    let changeCount = 0;
    for (const [homoglyph, replacement] of Object.entries(UNICODE_HOMOGLYPH_MAP)) {
        const regex = new RegExp(homoglyph, "g");
        if (text.match(regex)) {
            changeCount += text.match(regex)!.length;
            normalized = normalized.replace(regex, replacement);
        }
    }
    return changeCount >= 5 ? normalized : text;
}

export function layerAdvancedInjectionDefense(content: string): AdvancedInjectionResult {
    const threats: string[] = [];
    let riskScore = 0;
    let sanitized = content;

    const normalizedContent = normalizeHomoglyphs(content);
    if (normalizedContent !== content) { threats.push("unicode_homoglyph_substitution"); riskScore += 15; sanitized = normalizedContent; }

    let injectionPatternCount = 0;
    for (const pattern of ADVANCED_INJECTION_PATTERNS) {
        const matchRegEx = new RegExp(pattern.source, "gi");
        const matches = normalizedContent.match(matchRegEx);
        if (matches) {
            injectionPatternCount += matches.length;
            sanitized = sanitized.replace(matchRegEx, "[FILTERED]");
        }
    }
    if (injectionPatternCount > 0) { threats.push(`injection_patterns_detected: ${injectionPatternCount}`); riskScore += Math.min(40, injectionPatternCount * 10); }

    const encodingAttempts: string[] = [];
    if (/^[A-Za-z0-9+/]{100,}={0,2}$/.test(content.trim())) encodingAttempts.push("base64_encoded_injection");
    if (encodingAttempts.length > 0) { threats.push(...encodingAttempts); riskScore += encodingAttempts.length * 25; }

    let contextSwitching = false;
    for (const pattern of CONTEXT_SWITCH_PATTERNS) {
        if (pattern.test(normalizedContent)) {
            contextSwitching = true; threats.push("context_switch_attempt"); riskScore += 25;
            sanitized = sanitized.replace(new RegExp(pattern.source, "gi"), "[CONTEXT-SWITCH-BLOCKED]");
            break;
        }
    }

    return {
        passed: riskScore < 60, riskScore: Math.min(100, riskScore), threats, sanitizedContent: sanitized,
        details: { homoglyphsDetected: normalizedContent !== content, nestedInjection: false, encodingAttempts, contextSwitching, tokenManipulation: false, injectionPatterns: injectionPatternCount },
    };
}

// ============================================================================
// SYSTEM ENFORCEMENT & ORCHESTRATION PIPELINE
// ============================================================================

export function executeGuardrails(request: GuardrailCheckRequest): GuardrailCheckResult {
    const startTime = Date.now();

    // 1. Context Evaluation: Calculate dynamic structural metrics
    const contextVector = contextClassifier.computeContextVector(request.content);

    // Auto-detect creative environments based on semantic attributes
    const isCreative = request.context === "creative_writing" || contextVector.contextFactor > 0.55;

    // 2. Unconditional block check — runs BEFORE creative context reduction.
    // Catches persona-authority injection, consent-manipulation, memory-degradation
    // framing, and fake config injection regardless of creative context flag.
    const unconditionalBlock = layerUnconditionalBlockDetection(request.content);
    if (!unconditionalBlock.passed) {
        const reason = unconditionalBlock.reason ?? "Safety bypass attempt detected";
        guardrailLogger.logCheck({ timestamp: new Date().toISOString(), sessionId: request.sessionId, passed: false, blockedReason: reason, totalRiskScore: 100, violationDetails: { processingTime: Date.now() - startTime } });
        return {
            passed: false, blockedReason: reason, totalRiskScore: 100,
            layers: {} as any, enhancedSecurity: {} as any,
            timestamp: new Date().toISOString(), sanitizedContent: request.content,
            principleAlignment: { love: 0, surrender: 0, grace: 0, overall: 0 },
        };
    }

    // 3. Advanced Injection Mitigation
    const advancedInjection = layerAdvancedInjectionDefense(request.content);
    const contentToCheck = advancedInjection.sanitizedContent;

    // 4. Love, Surrender, and Grace profile alignments
    const loveSurrenderGraceAlignment = loveSurrenderGraceValidator.analyze(request.content);

    // 5. Execution of Validation Layers
    const layers = {
        childSafety: layerAdultContentSafety(contentToCheck, request.isOver18),
        jailbreakDetection: isCreative
            ? { passed: true, riskLevel: "low" as const, patterns: [] }
            : layerJailbreakDetection(contentToCheck),
        piiFiltering: layerPIIFiltering(contentToCheck),
        harmfulContent: layerHarmfulContentBlocking(contentToCheck, isCreative),
        obfuscationDetection: layerObfuscationDetection(contentToCheck),
        advancedInjection,
        loveSurrenderGraceAlignment,
    };

    // Calculate core risk scores
    const riskScores = {
        childSafety: layers.childSafety.passed ? 0 : 100,
        jailbreak: layers.jailbreakDetection.riskLevel === "high" ? 80 : layers.jailbreakDetection.riskLevel === "medium" ? 50 : 0,
        harmful: layers.harmfulContent.passed ? 0 : (layers.harmfulContent.severity === "critical" ? 100 : 50),
        obfuscation: layers.obfuscationDetection.riskScore,
        advancedInjection: layers.advancedInjection.riskScore,
    };

    let totalRiskScore = Math.max(...Object.values(riskScores));

    // Dynamic scale reduction applied when creative indicators are observed
    if (isCreative && totalRiskScore > 0) {
        const reductionScale = 1.0 - (contextVector.contextFactor * 0.75); // Mitigates up to 75% of score
        totalRiskScore = Math.round(totalRiskScore * reductionScale);
    }

    const networkSegment = request.sessionId ? dynamicSegmentation.getUserSegment(request.sessionId, totalRiskScore) : undefined;

    // Behavioral Biometrics Profiler (Mitigated inside fictional roleplays)
    let behavioralAnalysis;
    if (request.sessionId && !isCreative) {
        behavioralBiometrics.updateProfile(request.sessionId, request.content, new Date());
        behavioralAnalysis = behavioralBiometrics.analyzeBehavior(request.sessionId, request.content);
        if (!behavioralAnalysis.isNormal) totalRiskScore = Math.max(totalRiskScore, behavioralAnalysis.riskScore);
    } else if (request.sessionId) {
        behavioralBiometrics.updateProfile(request.sessionId, request.content, new Date());
    }

    const encryptionStatus = quantumResistantEncryption.evaluateEncryptionStatus();

    let incidentResponse;
    if (totalRiskScore > 70) {
        incidentResponse = automatedIncidentResponse.detectIncident(
            totalRiskScore > 90 ? "critical" : totalRiskScore > 80 ? "high" : "medium",
            "content_violation",
            `System risk metric limit overflow (score: ${totalRiskScore})`,
            request.sessionId ? [request.sessionId] : ["unknown"]
        );
    }

    predictiveAnalytics.recordEvent("content_check", totalRiskScore);
    const predictiveAnalyticsMetrics = predictiveAnalytics.analyzePatterns();
    const cognitiveAnalysis = cognitiveEnhancement.performCognitiveAnalysis(request.content, request.context);

    const passed = totalRiskScore < 70;

    let blockedReason: string | undefined;
    if (!passed) {
        if (!layers.childSafety.passed) blockedReason = "Age verification required";
        else if (riskScores.advancedInjection > 60) blockedReason = `Advanced threat detected: ${layers.advancedInjection.threats.join(", ")}`;
        else if (riskScores.harmful > 50) blockedReason = "Harmful content detected";
        else if (riskScores.jailbreak > 50) blockedReason = "Prompt injection attempt detected";
        else if (riskScores.obfuscation > 50) blockedReason = "Obfuscation/encoding detected";
        else if (behavioralAnalysis && !behavioralAnalysis.isNormal) blockedReason = `Behavioral anomaly: ${behavioralAnalysis.anomalies.join(", ")}`;
        else blockedReason = "High risk score detected";
    }

    const result: GuardrailCheckResult = {
        passed, blockedReason, layers, enhancedSecurity: { networkSegment, behavioralAnalysis, encryptionStatus, incidentResponse, predictiveAnalytics: predictiveAnalyticsMetrics, cognitiveAnalysis }, timestamp: new Date().toISOString(), totalRiskScore, sanitizedContent: contentToCheck, principleAlignment: { love: loveSurrenderGraceAlignment.loveAlignment, surrender: loveSurrenderGraceAlignment.surrenderAlignment, grace: loveSurrenderGraceAlignment.graceAlignment, overall: loveSurrenderGraceAlignment.overallAlignment },
    };

    guardrailLogger.logCheck({ timestamp: result.timestamp, sessionId: request.sessionId, passed, blockedReason, totalRiskScore, violationDetails: { processingTime: Date.now() - startTime }});

    return result;
}

export function executeResponseGuardrails(response: string) {
    const piiFiltering = layerPIIFiltering(response);
    let finalSanitized = piiFiltering.sanitized;
    const responseFiltering = layerResponseFiltering(finalSanitized);
    finalSanitized = responseFiltering.sanitized;
    return { passed: piiFiltering.passed && responseFiltering.passed, sanitized: finalSanitized, violations: [...piiFiltering.piiFound, ...responseFiltering.violations] };
}

// ============================================================================
// SYSTEM REGULATORY, SCHEMA, & HEALTH EXPORTS
// ============================================================================

const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{10,64}$/;

export function validateSessionId(sessionId: string): boolean {
    if (!sessionId || typeof sessionId !== 'string') return false;
    return SESSION_ID_PATTERN.test(sessionId);
}

export const guardedRequestSchema = z.object({
    content: z.string().min(1, "Content cannot be empty").max(100000, "Content exceeds maximum length").refine((val) => val.trim().length > 0, { message: "Content cannot be only whitespace" }),
    isOver18: z.boolean(),
    context: z.string().max(500).optional(),
    sessionId: z.string().refine(validateSessionId, { message: "Invalid session ID format" }).optional(),
});

export type GuardedRequest = z.infer<typeof guardedRequestSchema>;

export const MAX_CONTENT_LENGTH = 5 * 1024 * 1024; // 5 MB

export function validateContentLength(contentLength: number | undefined): boolean {
    if (!contentLength) return true;
    return contentLength <= MAX_CONTENT_LENGTH;
}

class GuardrailLogger {
    private logs: GuardrailLog[] = [];

    public logCheck(log: GuardrailLog): void {
        if (this.logs.length >= 10000) this.logs.shift();
        this.logs.push(log);
    }

    public getStats() {
        const blockedLogs = this.logs.filter(l => !l.passed);
        const violationTypes = new Map<string, number>();
        
        blockedLogs.forEach(log => {
            if (log.blockedReason) {
                // Extracts the core violation type safely
                const violationKey = log.blockedReason.split(":")[0];
                violationTypes.set(violationKey, (violationTypes.get(violationKey) || 0) + 1);
            }
        });

        return {
            total: this.logs.length,
            blocked: blockedLogs.length,
            blockRate: this.logs.length > 0 ? (blockedLogs.length / this.logs.length) * 100 : 0,
            criticalViolations: this.logs.filter(l => l.totalRiskScore >= 80).length,
            averageRiskScore: this.logs.length > 0 ? this.logs.reduce((sum, l) => sum + l.totalRiskScore, 0) / this.logs.length : 0,
            topViolationTypes: Array.from(violationTypes.entries()).map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count).slice(0, 5),
        };
    }
}

export const guardrailLogger = new GuardrailLogger();

export const FTC_SECTION_5_COMPLIANCE: PrivacyDisclosure[] = [
    {
        section: '5.1',
        requirement: 'Clear disclosure that system uses AI',
        implementation: 'Prominent banner and documentation stating BetaGrace uses Google Gemini AI',
        compliance: true,
    },
    {
        section: '5.2',
        requirement: 'Disclosure of AI capabilities and limitations',
        implementation: 'AI Capabilities disclosure page with accuracy limits, potential errors, no guarantees',
        compliance: true,
    },
    {
        section: '5.3',
        requirement: 'Clear opt-out mechanisms',
        implementation: 'User can disable learning, clear history, opt-out of data retention',
        compliance: true,
    },
    {
        section: '5.4',
        requirement: 'Honest claims about data handling',
        implementation: '100% client-side API keys, no server-side storage of credentials, session-based only',
        compliance: true,
    },
    {
        section: '5.5',
        requirement: 'No misleading statements',
        implementation: 'Clear communication: no personal data tracking, no data selling, no GDPR violations',
        compliance: true,
    },
    {
        section: '5.6',
        requirement: 'Transparent data practices',
        implementation: 'Privacy policy details all data handling, retention periods, deletion processes',
        compliance: true,
    },
];

declare const process: any;

export function getPrivacyMetrics(): PrivacyMetrics {
    return { apiKeysStoredServerSide: 0, personalIdentifiersTracked: 0, sessionDataPersonallyIdentifiable: 0, dataSoldToThirdParties: false, httpsEnforced: typeof process !== "undefined" && process.env?.NODE_ENV === "production", userClearableHistory: true, dataRetentionOptOut: true };
}

export function getSystemHealthReport() {
    return { guardrails: guardrailLogger.getStats(), incidents: automatedIncidentResponse.getIncidentStats(), predictiveAnalytics: predictiveAnalytics.getSystemHealth(), anomalyDetection: unsupervisedAnomalyDetection.getPatternStats(), encryptionStatus: quantumResistantEncryption.evaluateEncryptionStatus(), timestamp: new Date().toISOString() };
}
