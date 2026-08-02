# BetaGrace

## Privacy Policy

Your privacy is important to us. This policy explains how BetaGrace collects, uses, and protects your information.

**Version 2.0 • Last Updated: MAY 2026**

### On This Page

* Overview
* Information We Collect
* How We Use Information
* Information Sharing
* Data Retention
* Your Rights
* Children's Privacy
* Contact Us
* User Responsibility

### Overview

BetaGrace ("we", "us", or "our") operates the BetaGrace creative writing assistant. This Privacy Policy describes how we collect, use, disclose, and protect information that applies to our service, and your choices regarding the collection and use of your information.

By using BetaGrace, you agree to the collection and use of information in accordance with this policy. We are committed to protecting your privacy and ensuring compliance with applicable U.S. federal laws.

### Information We Collect

#### Information You Provide

* **Age Verification:** We collect whether you are 18 years of age or older to comply with COPPA requirements.
* **Conversation Data:** The prompts and messages you send to our AI writing assistant.
* **Preferences:** Your mode selections, theme preferences, and cookie consent choices.
* **Feedback:** Any feedback or correspondence you provide to us.

#### Automatically Collected Information

* **Usage Data:** How you interact with the service, including features used and time spent.
* **Device Information:** Browser type, operating system, and device identifiers.
* **Log Data:** IP address, access times, and pages viewed.

**Note:** We do not collect sensitive personal information such as Social Security numbers, financial account information, or precise geolocation data.

### How We Use Information

We use the information we collect to:

* Provide, maintain, and improve our AI writing assistant services
* Generate creative writing responses based on your prompts
* Personalize your experience and remember your preferences
* Develop new features and improve our AI models through parallel learning
* Ensure compliance with applicable laws, including age verification
* Communicate with you about service updates or issues
* Detect, prevent, and address technical issues or abuse

#### Parallel Learning System

With your consent, we use a parallel learning system that analyzes conversation patterns to improve our AI's writing capabilities. This learning is:

* Anonymized and aggregated
* Used only to improve writing quality and mode accuracy
* Subject to your opt‑out preferences
* Never shared with third parties

### Information Sharing

We do not sell your personal information. We may share information:

* **Service Providers:** With third‑party vendors who perform services on our behalf (e.g. , Hosting, image generation via Pollinations Flux)
* **Legal Requirements:** When required by law, subpoena, or legal process
* **Protection:** To protect the rights, property, or safety of BetaGrace, our users, or others
* **Business Transfers:** In connection with a merger, acquisition, or sale of assets

#### AI Synthesis \& Third‑Party Services

Text generation requests are routed through a secure, multi-provider fallback chain managed by your self-hosted instance. This includes the Pollinations.ai API, HuggingFace Inference API, and Google Cloud Vertex AI (configured with enterprise-grade data protection to ensure no data is used for model training). All conversational data is handled in accordance with the respective providers' enterprise terms; notably, no data is used for corporate model training by these services. All message histories are stored exclusively within your private, local PostgreSQL instance. A fully offline Local Synthesis Engine serves as the final endpoint fallback.
Important Privacy Notice: While this architecture is designed to support high-level data privacy, the final security posture depends on your account configuration. Please ensure your respective API keys for Google Cloud, Pollinations, and Hugging Face are set to "Data Sharing: Off" or "No-Training" within your provider's dashboard, as required by your specific service providers.

We use third-party services only for:

* **Image Generation:** Pollinations Flux API for optional image creation (image prompts only, not full conversation context)

**Hosting \& Infrastructure:** Pollinations Flux API, HuggingFace API. Local Fallback BM25.

Data Retention

We retain your information only as long as necessary to provide our services and fulfill the purposes described in this policy.

* **Conversation Data:** Retained for a maximum of **30 rolling days** from the date of last interaction, unless you opt out sooner. Stored locally in your PostgreSQL database.
* **Account Preferences:** Retained until you delete them or request deletion
* **Consent \& Compliance Records:** Retained for a minimum of 12 months for legal audit purposes. No third-party analytics services are used; all data remains on your self-hosted PostgreSQL instance.

You may opt out of data retention at any time through your privacy settings. When you opt out, we will delete your stored conversation data within 30 days.

**AI Learning Data Retention:** BetaGrace reserves all rights to retain learning data generated through your interactions with the Service, including the right to collect, store, and use such AI learning data indefinitely. This includes, but is not limited to, writing-style patterns, mode preferences, topic interests, story elements, narrative themes, character details, and plot points captured during your sessions. BetaGrace may retain this learning data indefinitely for the purpose of improving, training, and personalizing the Service, regardless of whether you opt out of general conversation data retention. Opting out of data retention will prevent new learning data from being saved going forward, but does not affect learning data already collected prior to opt-out. By using the Service, you grant BetaGrace a perpetual, irrevocable, worldwide, royalty-free license to use, reproduce, and incorporate such learning data into the Service.

### Your Rights \& Data Control

You have the following rights regarding your personal information:

* **Access:** Request a copy of the personal information we hold about you: session, conversations, messages, consent, learning\_data, long\_term\_memory.
* **Correction:** Request correction of inaccurate personal information.
* **Deletion:** Request deletion of your personal information at any time
* **Pre‑Use Data Deletion:** DELETE all your chat history and conversation data, BEFORE using BetaGrace by visiting your Settings.
* Our automated backend features native, single-click mechanisms to instantly execute hard-deletes across all ten database tables via cascade, alongside a formal Article 17 submission dashboard that registers, tracks, and automatically processes data-clearing timelines on a rolling 30-day cycle.
* **Complete Opt‑Out:** Opt out of ALL data retention and parallel learning BEFORE using the Service
* **Portability:** Data Portability (GDPR Article 20): You can instantly download a single, secure ZIP archive directly from your Settings panel containing your complete operational footprint, broken down across six Files, session, conversations, messages, consent, learning\_data, long\_term\_memory, and a compliant README.txt, alongside a regulatory documentation index.
* **Withdraw Consent:** Withdraw consent for data processing where applicable

**Important:** You can delete your entire chat history and opt out of all data retention through Privacy Settings BEFORE using BetaGrace. This gives you complete control over whether any of your data is stored.

To exercise these rights, visit your Privacy Settings or open an issue on the project's GitHub repository.

### User Responsibility \& Vulnerability Disclaimer

BetaGrace and its creators are NOT responsible for misuse, irresponsible use, or user vulnerabilities in handling personal data or generated content. Key points:

* **Unauthorized Access:** Damages from unauthorized access to your data are the user's responsibility to prevent through secure password management
* **Data Alteration:** Damages from alteration of your data fall solely on your preferences and security practices
* **Vulnerability Misuse:** Any misuse arising from BetaGrace's system vulnerabilities is the user's responsibility to report via the project's GitHub repository
* **Resale Responsibility:** If you resell generated content, YOU are responsible for all legal compliance under applicable law
* **Governed by:** These terms fall under the agreement in the Terms of Service and applicable U.S. law

You can delete all your chat history and opt out of data retention BEFORE using BetaGrace. This is entirely within your control through Privacy Settings.

### Children's Privacy (COPPA Compliance)

BetaGrace complies with the Children's Online Privacy Protection Act (COPPA). We do not knowingly collect personal information from children under 18 years of age without verifiable parental consent.

#### Our Practices

* We require age verification before allowing access to our services
* Users who indicate they are under 18 are not permitted to use the service
* If we learn we have collected information from a child under 18, we will delete it promptly
* Parents may contact us to review, delete, or refuse further collection of their child's information

#### Parental Rights

Parents or guardians who believe their child has provided personal information to us should contact the maintainers immediately via the project's GitHub repository. We will take steps to remove such information and terminate any associated accounts.

### Contact Us

If you have questions about this Privacy Policy or our privacy practices, please open an issue or discussion on the project's GitHub repository.
