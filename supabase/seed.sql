-- Local dev seed data for `supabase db reset`.
--
-- Safe to re-run: every insert below is idempotent (ON CONFLICT DO NOTHING on
-- fixed, well-known ids, or an UPDATE keyed on id). Nothing here touches the
-- hosted/remote project — this only ever runs against the local Postgres
-- instance started by `supabase start`.
--
-- Contents:
--   1. Preset rubrics + rubric_items (the 6 standard templates), extracted
--      from a one-time read of the team's production data export — ids
--      preserved so any code/fixtures referencing them keep working. No
--      other production data (documents, reviews, real users, annotations,
--      etc.) is included.
--   2. Four fake local test accounts (reviewer/author/coordinator/admin),
--      @example.test emails, shared dev-only password. Not real people.

-- pgcrypto provides crypt()/gen_salt() for hashing the test-account passwords
-- below. Supabase's local Postgres image normally ships this already; the
-- IF NOT EXISTS makes this file safe either way.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── 1. Preset rubrics ──────────────────────────────────────────────────────

-- rubrics: 6 rows
INSERT INTO public.rubrics (id, title, description, created_at, is_preset, operational_definition) VALUES
  ('a0000001-0000-0000-0000-000000000001', 'Accessibility', 'Evaluates whether OER can be used by all learners regardless of abilities, disabilities, or technological constraints.', '2026-05-27 15:12:15.849485+00', TRUE, 'Accessibility for Open Educational Resources (OER) refers to the design and development of educational materials that can be used by all learners, regardless of their abilities, disabilities, or technological constraints. Accessible OER ensures that content is perceivable, operable, understandable, and robust for users with diverse needs, including those who rely on assistive technologies.'),
  ('a0000002-0000-0000-0000-000000000002', 'Copy Editing', 'Evaluates grammatical correctness, mechanical accuracy, stylistic consistency, and clarity throughout the OER.', '2026-05-27 15:12:42.334263+00', TRUE, 'Copy editing for Open Educational Resources (OER) refers to the professional standard of editorial review that ensures grammatical correctness, mechanical accuracy, stylistic consistency, and clear communication throughout educational materials. This encompasses systematic correction of spelling, punctuation, capitalization, and syntax errors; consistent application of style guide conventions; verification of internal consistency in terminology, formatting, and usage; and enhancement of readability for the intended audience.'),
  ('a0000003-0000-0000-0000-000000000003', 'Copyright Review', 'Evaluates proper legal authorization, licensing documentation, attribution practices, and communication of reuse permissions in OER.', '2026-05-27 15:13:08.753975+00', TRUE, 'Copyright Review for Open Educational Resources (OER) refers to the systematic examination of educational materials to ensure proper legal authorization for all included content, appropriate application of copyright exceptions (including fair use), accurate licensing documentation, and clear communication of reuse permissions. High-quality copyright practices demonstrate proper attribution of sources, appropriate selection and application of open licenses, documented justification for fair use claims, compliance with third-party license requirements, and transparent communication about copyright status for all components.'),
  ('a0000004-0000-0000-0000-000000000004', 'Disciplinary Appropriateness', 'Evaluates scholarly rigor, factual accuracy, comprehensive coverage, and currency within the OER''s academic discipline.', '2026-05-27 15:13:28.628592+00', TRUE, 'Disciplinary appropriateness for Open Educational Resources (OER) refers to the extent to which educational materials demonstrate scholarly rigor, factual accuracy, comprehensive coverage, and currency within their respective academic disciplines. This encompasses the OER''s adherence to established disciplinary standards, its reflection of current scholarship and research, and its appropriateness for college-level learning objectives.'),
  ('a0000005-0000-0000-0000-000000000005', 'eLearning', 'Evaluates digital tools, technologies, and platforms integrated into OER for functionality, pedagogical effectiveness, and technical reliability.', '2026-05-27 15:13:55.210965+00', TRUE, 'eLearning for Open Educational Resources (OER) refers to the degree to which digital tools, technologies and/or platforms integrated into educational materials demonstrate functional excellence, pedagogical effectiveness, technical reliability, and accessibility for diverse learners. High-quality eLearning seamlessly supports learning objectives through intuitive interfaces, robust functionality, cross-platform compatibility, and evidence of enhancing student engagement and learning outcomes.'),
  ('a0000006-0000-0000-0000-000000000006', 'Universal Design for Learning (UDL)', 'Evaluates whether OER incorporates flexible instructional design that supports diverse learners through multiple means of engagement, representation, and expression.', '2026-05-27 15:14:23.981192+00', TRUE, 'Universal Design for Learning (UDL) for Open Educational Resources (OER) refers to a research-based educational framework that guides the proactive design of flexible learning environments and instructional materials to accommodate the full range of learner variability. UDL is grounded in three core principles: (1) Multiple Means of Engagement, (2) Multiple Means of Representation, and (3) Multiple Means of Action and Expression. Unlike accessibility, which focuses on technical compliance, UDL is a pedagogical approach focused on instructional design choices that provide multiple pathways for all learners.')
ON CONFLICT (id) DO NOTHING;

-- rubric_items: 50 rows
INSERT INTO public.rubric_items (id, rubric_id, label, description, sort_order, created_at) VALUES
  ('13b858b9-f996-448b-a2e2-96664847a774', 'a0000001-0000-0000-0000-000000000001', 'C1 Text Structure and Screen Reader Navigation', '1. All text content includes proper heading hierarchy (H1–H6), with logical nesting and no skipped levels.
2. Lists use proper markup (bulleted/numbered).
3. Reading order matches visual layout and intended flow of information.
4. Page navigation coding supports the use of adaptive technology.', 1, '2026-05-27 15:12:15.849485+00'),
  ('68a5ae85-9dbd-443e-9dd2-e1f168e05f10', 'a0000001-0000-0000-0000-000000000001', 'C2 Visual Design and Color', '1. Text and background colors meet WCAG 2.1 AA contrast ratios (4.5:1 for normal text, 3:1 for large text).
2. Information is not conveyed by color alone.
3. Font size is minimum 12pt for body text.
4. Visual layout supports logical reading flow.', 2, '2026-05-27 15:12:15.849485+00'),
  ('d28821fd-66b3-4489-adf0-c49670242c13', 'a0000001-0000-0000-0000-000000000001', 'C3 Alternative Text and Image Accessibility', '1. All informative images include descriptive alternative text.
2. Decorative images are marked with null alt text.
3. Charts and graphs include data tables or detailed descriptions.', 3, '2026-05-27 15:12:15.849485+00'),
  ('95b40b5d-cd22-4d71-81e6-980abf4b71c9', 'a0000004-0000-0000-0000-000000000004', 'C2 Currency and Contemporaneity', '1. Content incorporates recent scholarship/research and praxis with good attention to contemporary developments.
2. Shows awareness of evolving disciplinary perspectives while maintaining connection to foundational knowledge.
3. Information reflects current state of the field.', 2, '2026-05-27 15:13:28.628592+00'),
  ('837aa028-8dca-43b4-83b3-1d8aaa4b3496', 'a0000002-0000-0000-0000-000000000002', 'C7 Formatting and Visual Consistency', '1. Headings follow a logical hierarchical structure with consistent formatting.
2. Font usage, size, and styling (bold, italic) are applied consistently and appropriately.
3. Lists (bulleted and numbered) are formatted consistently. Spacing (line, paragraph, and section) is uniform throughout.
4. Visual elements maintain professional presentation standards.', 7, '2026-05-27 15:12:42.334263+00'),
  ('40fa4bd9-9289-4f30-a600-320d22c41cf1', 'a0000002-0000-0000-0000-000000000002', 'C1 Grammar and Syntax', '1. Text demonstrates proper sentence construction with correct subject-verb agreement, pronoun-antecedent agreement, and appropriate verb tenses.
2. Sentences are complete and well-formed.
3. Modifiers are correctly placed.
4. Fragments and run-ons are intentional and effective where used.
5. Sentence variety supports readability and maintains reader engagement.', 1, '2026-05-27 15:12:42.334263+00'),
  ('ea1c323f-9303-49ed-a773-c8d03b05a81e', 'a0000003-0000-0000-0000-000000000003', 'C1 Original Content Licensing', '1. All originally created content in the OER is clearly licensed under an appropriate open license (e.g., CC BY, CC BY-SA, CC BY-NC).
2. The license is prominently displayed and easily located by users.
3. The chosen license is appropriate for the intended use and adaptability of the resource.
4. License terms are applied consistently throughout the resource.', 1, '2026-05-27 15:13:08.753975+00'),
  ('6ae727f6-b132-498c-9902-df12a809dbf5', 'a0000002-0000-0000-0000-000000000002', 'C2 Spelling and Typographical Accuracy', '1. All words are spelled correctly according to the chosen language variant (e.g., American or British English).
2. Technical and discipline-specific terms are spelled accurately and consistently.
3. Proper nouns are correctly spelled throughout.
4. Typographical errors are absent or extremely rare (fewer than one per 5,000 words).', 2, '2026-05-27 15:12:42.334263+00'),
  ('8960e339-b500-4789-ad14-99ccee2933d0', 'a0000002-0000-0000-0000-000000000002', 'C3 Punctuation and Mechanics', '1. Punctuation follows the conventions of the chosen style guide consistently.
2. Commas, semicolons, colons, apostrophes, quotation marks, hyphens, and dashes are used correctly.
3. Capitalization follows established conventions for titles, headings, proper nouns, and sentence beginnings.
4. Number usage (numerals vs. words) follows style guide rules consistently.', 3, '2026-05-27 15:12:42.334263+00'),
  ('cf701edd-9ef7-4dee-995a-8f941014a82a', 'a0000001-0000-0000-0000-000000000001', 'C4 Multimedia Accessibility', '1. Videos include accurate closed captions and transcripts.
2. Audio content provides complete transcripts.
3. Media players are keyboard accessible and compatible with assistive technology.
4. Auto-playing content can be paused or stopped.', 4, '2026-05-27 15:12:15.849485+00'),
  ('2d970e1d-8d41-4c25-87fc-2963dd4d4c68', 'a0000002-0000-0000-0000-000000000002', 'C4 Style Guide Consistency', '1. A recognized editorial style guide (e.g., APA, Chicago, MLA, institutional style) is applied consistently throughout the text.
2. Abbreviations, acronyms, terminology, and formatting choices are uniform.
3. Deviations from the style guide are intentional and appropriate for the discipline or context.', 4, '2026-05-27 15:12:42.334263+00'),
  ('4651725c-8dda-4ee5-9807-18237fc3515e', 'a0000001-0000-0000-0000-000000000001', 'C5 Interactive Elements and Forms', '1. All interactive elements (links, buttons, form fields) are keyboard accessible.
2. Form fields have labels and instructions.
3. Error messages are descriptive and actionable to promote troubleshooting.
4. Focus indicators are visible and logical.', 5, '2026-05-27 15:12:15.849485+00'),
  ('5a8ffcca-7b08-4da9-bbc4-f0c626b58ac9', 'a0000002-0000-0000-0000-000000000002', 'C5 Internal Consistency and Usage', '1. Terminology is used consistently throughout (e.g., "learner" vs. "student," "e-learning" vs. "eLearning").
2. Commonly confused words are used correctly (e.g., affect/effect, complement/compliment).
3. Discipline-specific usage conventions are followed.
4. Parallel structure is maintained in lists, headings, and series.
5. Point of view and voice are consistent unless intentionally varied for pedagogical purposes.', 5, '2026-05-27 15:12:42.334263+00'),
  ('e929e880-1cbc-4e85-af7d-fc262b4a1310', 'a0000002-0000-0000-0000-000000000002', 'C6 Clarity and Readability', '1. Sentences are clear, concise, and accessible to the intended audience.
2. Plain language is used appropriately; jargon is defined when first introduced.
3. Sentence length and complexity are appropriate for the target audience.
4. Transitions between ideas are smooth and logical. Ambiguity is eliminated.
5. Text flows naturally and maintains reader comprehension.', 6, '2026-05-27 15:12:42.334263+00'),
  ('9bb43d0f-9780-4069-a35d-8388df568f28', 'a0000001-0000-0000-0000-000000000001', 'C6 Table Structure and Data Presentation', '1. Data tables include proper header markup and scope attributes.
2. Tables are not used for layout purposes.
3. Complex tables provide summaries or navigation aids.
4. Row and column relationships are clearly defined.', 6, '2026-05-27 15:12:15.849485+00'),
  ('25153f72-483c-4600-a527-2f64c5ce2ea1', 'a0000001-0000-0000-0000-000000000001', 'C7 Link Quality and Context', '1. Link text is descriptive and meaningful out of context (in general, avoids "click here" or URL-only links unless links themselves are descriptive).
2. Links indicate when opening in new windows or leading to different file formats.
3. Link purposes are clear from context or link text alone.', 7, '2026-05-27 15:12:15.849485+00'),
  ('06fbe570-6b46-44a7-966c-6e66abb1061c', 'a0000001-0000-0000-0000-000000000001', 'C8 Technical Format and Compatibility', '1. Content is available in formats that preserve accessibility features.
2. Resources work across multiple devices and platforms (responsive design).
3. The learner does not need to use additional specific software or plugins to access resources.', 8, '2026-05-27 15:12:15.849485+00'),
  ('3f8d5ab3-2403-445c-9c25-1ed21fc6f009', 'a0000002-0000-0000-0000-000000000002', 'C8 Citations, References, and Attributions', '1. In-text citations follow the chosen citation style accurately and consistently.
2. Reference lists or bibliographies are complete, accurately formatted, and properly ordered.
3. All borrowed material is appropriately cited.
4. Attribution statements for images, media, and adapted content are present, accurate, and properly formatted according to Creative Commons or licensing requirements.', 8, '2026-05-27 15:12:42.334263+00'),
  ('645a0480-8902-4308-8463-43cf18560352', 'a0000002-0000-0000-0000-000000000002', 'C10 Inclusive and Accessible Language', '1. Language is inclusive and avoids bias related to gender, race, ethnicity, disability, age, sexual orientation, and other characteristics.
2. Cultural sensitivity is evident in examples and references.
3. Language supports accessibility for diverse learners, including those using assistive technologies.
4. Idioms and colloquialisms are used judiciously with consideration for multilingual audiences.', 10, '2026-05-27 15:12:42.334263+00'),
  ('d7fc5868-0abf-49f9-bf97-8b9db70ff0ea', 'a0000002-0000-0000-0000-000000000002', 'C9 Cross-References and Navigational Elements', '1. Internal cross-references (chapter, section, page, figure, and table references) are accurate and functional.
2. Hyperlinks work correctly and open as intended. Figure and table numbers are sequential and correspond correctly to text references.
3. Glossary terms, index entries, and other navigational aids are accurate and complete.', 9, '2026-05-27 15:12:42.334263+00'),
  ('187e0e8d-cde5-416c-9f09-1c8a6924d4b2', 'a0000003-0000-0000-0000-000000000003', 'C6 Public Domain Materials', '1. Materials identified as public domain are accurately categorized as such based on copyright expiration, government works status, CC0 dedication, or other appropriate justifications.
2. Public domain status is clearly communicated to users.
3. When public domain determination is complex (e.g., pre-1928 works, government works with exceptions), adequate documentation or explanation is provided.
4. Public domain materials are distinguished from openly licensed materials.', 6, '2026-05-27 15:13:08.753975+00'),
  ('fab9f1f9-0d7a-48ea-9536-d29055667721', 'a0000004-0000-0000-0000-000000000004', 'C1 Content Accuracy and Validity', '1. All content is factually accurate with reliable, well-supported information.
2. Facts and data reflect current disciplinary understanding.
3. Any disputed content is identified as currently disputed or part of current debates.
4. Content is authoritative and appropriate for the intended college-level audience.
5. Sources are credible and properly verified.', 1, '2026-05-27 15:13:28.628592+00'),
  ('d87b8959-e2a5-4ca4-ac92-49b1313e4502', 'a0000003-0000-0000-0000-000000000003', 'C2 Third-Party Content Documentation', '1. All third-party content (images, graphs, tables, videos, audio, text excerpts) incorporated into the OER is clearly identified and documented.
2. For each third-party element, the source is noted with sufficient detail to locate the original.
3. The legal basis for inclusion (open license, public domain, fair use, or permission) is clearly indicated.
4. Documentation is provided in a consistent format throughout the resource.', 2, '2026-05-27 15:13:08.753975+00'),
  ('f2c1e482-892c-4211-ba93-1e0709216c39', 'a0000003-0000-0000-0000-000000000003', 'C3 Attribution Practices', '1. Proper attribution is provided for all third-party content that requires it, following the applicable license requirements or citation standards.
2. Attribution includes, as appropriate and available: creator/author name, title of work, source/URL, license type, and indication of any modifications made.
3. Attribution is placed appropriately (near the content, in captions, or in a credits section) and is sufficiently detailed to allow users to verify sources.
4. Public domain and fair use materials include appropriate citations even when not legally required.', 3, '2026-05-27 15:13:08.753975+00'),
  ('9e030aa0-2040-4f72-a7a4-7092f668215a', 'a0000004-0000-0000-0000-000000000004', 'C3 Disciplinary Completeness and Coverage', '1. Covers core disciplinary content thoroughly with good integration of key concepts.
2. Addresses essential topics with appropriate depth for target audience.
3. Presents main ideas clearly with explicit connections between concepts.
4. Content connects important associated concepts within the subject matter rather than presenting topics in isolation.
5. Scope aligns with standard expectations for the discipline.', 3, '2026-05-27 15:13:28.628592+00'),
  ('7b275a5e-a8ad-4b4b-9b1e-314f119483b8', 'a0000003-0000-0000-0000-000000000003', 'C4 Fair Use Application and Documentation', '1. When copyrighted materials are incorporated under fair use, the use aligns with established fair use principles (purpose and character, nature of work, amount used, market effect).
2. Fair use is applied appropriately for purposes such as criticism, comment, illustration for teaching, or scholarship.
3. The amount of copyrighted material used is appropriate and justified by the pedagogical purpose.
4. Fair use reliance is documented or signaled appropriately, enabling downstream users to understand the copyright status of components.', 4, '2026-05-27 15:13:08.753975+00'),
  ('e6669edb-fdb8-47bb-9228-e5ebfcdd1268', 'a0000004-0000-0000-0000-000000000004', 'C4 Scholarly Rigor and Theoretical Framework', '1. Demonstrates strong scholarly approach with solid analytical depth and appropriate theoretical grounding.
2. Shows competent understanding of disciplinary methodology and theoretical frameworks.
3. Evidence-based reasoning supports arguments and conclusions.', 4, '2026-05-27 15:13:28.628592+00'),
  ('7db31f0b-06e3-402b-b896-46f1a81c6d82', 'a0000004-0000-0000-0000-000000000004', 'C5 College-Level Appropriateness and Cognitive Demand', '1. Demonstrates appropriate intellectual complexity for college students.
2. Encourages critical thinking and higher-order reasoning with suitable cognitive demand for the discipline.
3. Content promotes academic skill development and independent inquiry.
4. Complex topics include sufficient scaffolding and direction.', 5, '2026-05-27 15:13:28.628592+00'),
  ('bcca34a9-6b42-4bea-9c54-127e6e3bad9a', 'a0000003-0000-0000-0000-000000000003', 'C5 License Compatibility and Documentation', '1. All incorporated openly licensed materials are used in compliance with their respective license terms.
2. When combining materials under different licenses, the licenses are compatible and the resulting work complies with all applicable license requirements.
3. If using CC BY-SA or other share-alike materials, the OER is licensed compatibly to allow legal adaptation.
4. No incompatible licenses are combined in ways that create legal conflicts.', 5, '2026-05-27 15:13:08.753975+00'),
  ('25ebd187-1eb0-41d4-ab85-e36811f50ad2', 'a0000004-0000-0000-0000-000000000004', 'C6 Source Quality and Documentation', '1. Uses high-quality, credible sources with consistent and accurate citation practices.
2. Shows good engagement with authoritative scholarship.
3. Documentation supports claims and enables verification.
4. Citation format follows disciplinary standards.', 6, '2026-05-27 15:13:28.628592+00'),
  ('b4beab04-2fb9-4bf6-ab2c-9c5edb49fc31', 'a0000004-0000-0000-0000-000000000004', 'C7 Assessment and Practice Quality', '1. Provides well-aligned assessments that measure major concepts appropriately.
2. The level of difficulty results from the complexity of subject-area content and cognitive demand, not from unrelated issues (e.g., overly complex vocabulary in math word problems).
3. Assessment modes include sufficient variety of exercise types and formats to facilitate mastery of targeted skills.
4. Most important aspects of learning expectations are targeted and given appropriate weight.', 7, '2026-05-27 15:13:28.628592+00'),
  ('ab11993e-18f9-425d-b09f-f98944ab19a8', 'a0000003-0000-0000-0000-000000000003', 'C7 Copyright Status Communication', '1. Each component of the OER clearly communicates its copyright status and reuse permissions to adopters and adapters.
2. A copyright statement or rights page explains the licensing approach used in the resource and provides guidance for users.
3. The resource distinguishes between different types of content (original, openly licensed third-party, fair use, public domain) in a way that enables users to understand their rights and obligations.
4. Information is presented clearly enough that educators without specialized copyright knowledge can understand and properly reuse the materials.', 7, '2026-05-27 15:13:08.753975+00'),
  ('848ade1b-8b32-48e7-9605-f87d36167bd5', 'a0000003-0000-0000-0000-000000000003', 'C8 Permissions and Documentation Trail', '1. For any materials used with explicit permission (beyond open licenses, public domain, or fair use), documentation of permission is maintained and can be provided upon request.
2. Permission documentation includes scope of use granted, attribution requirements, and any restrictions.
3. Contact information for permission-holders is retained.
4. The resource includes clear indication of what permissions cover and any limitations on use.', 8, '2026-05-27 15:13:08.753975+00'),
  ('17c572b9-d829-401a-b939-594bc5393cb7', 'a0000005-0000-0000-0000-000000000005', 'C6 Cost, Sustainability, and Resource Requirements', '1. All essential features of eLearning are available free of charge for educational use, or costs are clearly disclosed upfront and are reasonable.
2. If fees are required, they are unlikely to create financial barriers for students.
3. eLearning is supported by a stable organization with evidence of long-term sustainability.
4. Proper use does not require specialized equipment beyond what is typically available to students (computer, internet connection, standard peripherals).
5. There are no hidden costs or required upgrades that limit functionality.', 6, '2026-05-27 15:13:55.210965+00'),
  ('1ffb119a-644b-413f-a382-7fa702a88ac7', 'a0000005-0000-0000-0000-000000000005', 'C7 Accessibility', '1. eLearning meets accessibility guidelines (WCAG 2.1 AA standards, Section 508 requirements).
2. The interface works effectively with assistive technologies including screen readers and keyboard navigation.
3. Color contrast meets accessibility standards.
4. Alternative text is provided for images.
5. Videos include captions.
6. eLearning is designed to address needs of diverse users with varying abilities and learning preferences.
7. No learners are prevented from participating due to accessibility barriers.', 7, '2026-05-27 15:13:55.210965+00'),
  ('f4f7d27e-a0e3-4a82-9a01-b1dde7b0cbf8', 'a0000006-0000-0000-0000-000000000006', 'C2 Learner Choice in Expression and Demonstration', '1. Learning goals are clearly separated from the means of achieving them, allowing flexibility in how learners demonstrate understanding.
2. Learners have meaningful options for expression (written, oral, visual, performance, multimodal, use of varied tools/technologies).
3. Assessment formats allow learners to select modes that align with their strengths and cultural communication styles while maintaining construct validity.
4. Materials support graduated levels of scaffolding for practice and performance that can be adjusted based on learner needs.', 2, '2026-05-27 15:14:23.981192+00'),
  ('2b4939ab-cba3-477e-9e86-45351750a7b1', 'a0000005-0000-0000-0000-000000000005', 'C2 Technical Support and Documentation', '1. Comprehensive technical support is readily available through multiple channels (email, chat, phone, knowledge base).
2. Documentation is clear, complete, and addresses common questions and troubleshooting scenarios effectively.
3. Training resources are available for both instructors and students.
4. Response time for support inquiries is reasonable.
5. Help documentation and tutorials are readily accessible within the tool.', 2, '2026-05-27 15:13:55.210965+00'),
  ('9a8c3c7e-2d0b-4e1f-919f-42613edd26c2', 'a0000005-0000-0000-0000-000000000005', 'C3 Mobile Accessibility and Cross-Platform Compatibility', '1. eLearning is fully accessible on mobile devices through either a dedicated app or mobile-optimized browser version.
2. Mobile design appropriately addresses constraints of smaller screens while maintaining core functionality.
3. There is minimal functional difference between mobile and desktop versions.
4. eLearning functions effectively across both iOS and Android operating systems.
5. Users can access essential features regardless of the device, operating system, or browser they choose.', 3, '2026-05-27 15:13:55.210965+00'),
  ('df9b57fc-1fa7-46d7-b187-21077fd6637a', 'a0000005-0000-0000-0000-000000000005', 'C4 LMS Integration and Interoperability', '1. eLearning can be embedded or fully integrated into LMS while maintaining full functionality.
2. Integration is achieved through standard protocols (LTI compliance) that preserve user experience.
3. Grade data, if applicable, passes back to the LMS gradebook seamlessly.
4. Single sign-on authentication works properly.
5. The tool does not require students to create separate external accounts when accessed through the LMS.', 4, '2026-05-27 15:13:55.210965+00'),
  ('ec98e508-3da9-4c6b-ab0b-13ae7d5406ca', 'a0000006-0000-0000-0000-000000000006', 'C4 Transparent Expectations, Models, and Actionable Feedback', '1. Learning objectives are explicitly stated in learner-accessible language that clarifies both goals and their value.
2. Success criteria or rubrics are provided in advance with clear, specific descriptors (not vague terms).
3. Models, exemplars, or non-models at varying levels are provided to illustrate expectations.
4. Opportunities for formative feedback emphasize process, strategies, and improvement rather than relative performance or deficit-based critique.
5. Scaffolds and supports are designed for gradual release, supporting increasing learner independence over time.', 4, '2026-05-27 15:14:23.981192+00'),
  ('30e1ffd6-bd18-4d4d-8a7e-e6727e4d3559', 'a0000005-0000-0000-0000-000000000005', 'C5 Data Privacy, Security, and Ownership', '1. eLearning adheres to data privacy regulations and institutional policies (FERPA, GDPR as applicable).
2. Privacy policies are clearly stated and easily accessible.
3. Users maintain ownership of their intellectual property and data.
4. If external accounts are required, eLearning has been vetted for data protection compliance.
5. Users can save, archive, export, and download their work in multiple standard formats.
6. Content is not locked into proprietary systems.
7. Student data is not shared with third parties for commercial purposes.', 5, '2026-05-27 15:13:55.210965+00'),
  ('92c5f083-daa9-408f-8469-8d46c598e3de', 'a0000005-0000-0000-0000-000000000005', 'C8 Pedagogical Effectiveness and Learning Enhancement', '1. eLearning demonstrably supports and enhances the intended learning objectives of the OER.
2. Features align with sound pedagogical principles and effective instructional strategies.
3. eLearning adds meaningful value beyond what could be achieved through simpler means.
4. eLearning facilitates higher-order thinking skills appropriate to the content and level.
5. eLearning actively engages students through interactive, meaningful activities.
6. Students receive timely, actionable feedback on their performance.', 8, '2026-05-27 15:13:55.210965+00'),
  ('2da8d9fe-fd8e-4863-8d64-6c784395feeb', 'a0000005-0000-0000-0000-000000000005', 'C9 Learning Analytics and Customization', '1. eLearning collects meaningful data on student engagement, performance, and progress.
2. Analytics are presented in a user-friendly format that instructors can easily interpret and use for instructional decision-making.
3. Data can be accessed at both individual and aggregate levels.
4. Instructors can easily customize eLearning to suit their specific course context, learning outcomes, and teaching approaches.
5. eLearning can be adapted to different pedagogical strategies.
6. Course management features are efficient and do not create excessive administrative burden.', 9, '2026-05-27 15:13:55.210965+00'),
  ('bb4a68b0-d098-438a-ac4a-5edd9d8cc77c', 'a0000006-0000-0000-0000-000000000006', 'C1 Multiple Options for Representation and Perception', '1. Content is presented through multiple formats and modalities (text, visual, audio, video, interactive).
2. Information is available in more than one sensory mode.
3. Materials offer options for customizing display where appropriate (adjustable text size, layout options).
4. Key vocabulary, symbols, and complex language structures are clarified through definitions, examples, multimedia, or visual supports.
5. Complex ideas include both linguistic and non-linguistic representations (diagrams, models, metaphors, simulations).
6. Materials anticipate diverse ways learners process information and provide collective access through varied formats rather than requiring individual requests.', 1, '2026-05-27 15:14:23.981192+00'),
  ('6c6ba1b1-bfd3-4e30-aae6-125e2d24b656', 'a0000005-0000-0000-0000-000000000005', 'C1 Usability and Technical Functionality', '1. eLearning has an intuitive, user-friendly interface that instructors and students can learn to use effectively with minimal training.
2. Navigation is logical and consistent.
3. eLearning functions reliably across major desktop and mobile operating systems and current web browsers without requiring proprietary software or outdated plugins.
4. eLearning can be scaled to accommodate classes of any size without performance degradation.
5. Core features function consistently and reliably for all users.', 1, '2026-05-27 15:13:55.210965+00'),
  ('0d287d0e-06d2-4c85-9aa1-bcd8a7f48be3', 'a0000006-0000-0000-0000-000000000006', 'C3 Engagement, Relevance, and Cultural Responsiveness', '1. Content explicitly connects to real-world applications, authentic problems, or professional contexts.
2. Materials provide opportunities for learners to make meaningful choices related to topics, approaches, or applications that connect to their interests and goals.
3. Visual and textual content represents diverse identities, perspectives, and cultural frameworks authentically, avoiding stereotypical or token representations.
4. Examples and scenarios reflect varied lived experiences and cultural contexts.
5. Materials acknowledge and address potential biases in language use, representation, and assumptions about learners'' backgrounds.
6. Activities incorporate opportunities for exploration, creativity, and/or joyful engagement where appropriate.', 3, '2026-05-27 15:14:23.981192+00'),
  ('53d5a282-9e39-4b9b-ace9-73f92ed198a3', 'a0000006-0000-0000-0000-000000000006', 'C5 Collaboration, Communication, and Community', '1. Materials provide options for both individual and collaborative work.
2. Collaborative activities include clear structures (defined roles, interdependence, individual accountability) that support equitable participation.
3. Multiple communication formats are supported (synchronous/asynchronous, written/oral/visual).
4. Activities create opportunities for learners to build community, contribute diverse perspectives, develop sense of belonging, and foster care and connection.
5. Where appropriate, materials invite family or community participation to extend learning beyond the classroom.', 5, '2026-05-27 15:14:23.981192+00'),
  ('b818e626-b57f-4c5b-a837-a8835ccd6875', 'a0000006-0000-0000-0000-000000000006', 'C6 Metacognition, Self-Regulation, and Strategic Learning', '1. Materials support learners in setting personal goals, monitoring progress, and reflecting on learning processes and outcomes.
2. Opportunities for self-assessment and/or peer assessment are integrated with clear criteria.
3. Prompts, tools, or activities help learners develop metacognitive awareness (planning, strategy selection, evaluation of understanding, recognition of learning preferences).
4. Materials provide explicit support for organizing information and resources (templates, organizational tools, guides for managing tasks).
5. Activities help learners break large goals into manageable steps, anticipate challenges, and develop planning strategies.
6. Materials make thinking visible through modeling, worked examples, or prompts for learners to articulate their approaches.
7. Materials encourage learner agency in making choices about learning approaches and advocating for needed supports.', 6, '2026-05-27 15:14:23.981192+00'),
  ('ba811ff2-4215-4b4b-9236-247131ef7b48', 'a0000006-0000-0000-0000-000000000006', 'C7 Equity, Bias Awareness, and Inclusive Learning Environments', '1. Materials explicitly work to create learning environments that value and support all learners.
2. Content and activities address potential sources of bias, stereotype threat, or exclusion.
3. Strategies are included to reduce anxiety and increase access (predictable structures, options for managing sensory/social demands, flexible routines).
4. Materials foster discussions about diverse perspectives and provide opportunities for learners to challenge exclusionary practices and analyze how diversity improves learning.
5. Where appropriate, restorative or community-building approaches are integrated.
6. Content challenges singular narratives and makes space for diverse interpretations and approaches.', 7, '2026-05-27 15:14:23.981192+00'),
  ('473d7fe0-568d-4b03-894d-1ead8033f407', 'a0000006-0000-0000-0000-000000000006', 'C8 OER-Specific UDL Considerations', '1. Materials leverage open licensing to enable adaptation and customization for diverse learner needs.
2. Resources are available in multiple accessible file formats (not just formats that require proprietary software), supporting learners'' varied technology access and preferences.
3. If materials include multimedia, raw or editable files are provided to support remix and adaptation.
4. Metadata or accessibility statements clearly describe UDL features, format options, and any customization possibilities, helping instructors and learners understand how materials can be adapted.
5. Materials are designed with awareness that OER users may have limited technology access, providing low-bandwidth alternatives or downloadable options where appropriate.
6. Open licensing is explicitly framed as supporting collective access by enabling community adaptation and improvement.', 8, '2026-05-27 15:14:23.981192+00')
ON CONFLICT (id) DO NOTHING;

-- ─── 2. Test accounts ───────────────────────────────────────────────────────
--
-- Fixed ids so this is safe to re-run. Shared dev-only password — never used
-- outside this local database, not a real secret:
--   localdevpass123
--
-- public.handle_new_user() (fires on auth.users insert) only sets
-- id/email/display_name on public.users; role/roles/onboarding_completed are
-- finalized below once the trigger-created row exists. `roles` (text[]) is
-- what the app's own routing/authorization actually check (proxy.ts,
-- app/*/page.tsx); the `role` enum column (reviewer/author/admin) backs
-- current_user_role() and the few RLS/admin-only checks that use it.

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) VALUES
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000101',
   'authenticated', 'authenticated', 'reviewer@example.test',
   crypt('localdevpass123', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"display_name":"Test Reviewer"}',
   now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000102',
   'authenticated', 'authenticated', 'author@example.test',
   crypt('localdevpass123', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"display_name":"Test Author"}',
   now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000103',
   'authenticated', 'authenticated', 'coordinator@example.test',
   crypt('localdevpass123', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"display_name":"Test Coordinator"}',
   now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000104',
   'authenticated', 'authenticated', 'admin@example.test',
   crypt('localdevpass123', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"display_name":"Test Admin"}',
   now(), now(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.identities (
  id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
) VALUES
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000101',
   '{"sub":"00000000-0000-0000-0000-000000000101","email":"reviewer@example.test","email_verified":true}',
   'email', now(), now(), now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000102',
   '{"sub":"00000000-0000-0000-0000-000000000102","email":"author@example.test","email_verified":true}',
   'email', now(), now(), now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000103',
   '{"sub":"00000000-0000-0000-0000-000000000103","email":"coordinator@example.test","email_verified":true}',
   'email', now(), now(), now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-000000000104',
   '{"sub":"00000000-0000-0000-0000-000000000104","email":"admin@example.test","email_verified":true}',
   'email', now(), now(), now())
ON CONFLICT (provider_id, provider) DO NOTHING;

-- Finalize role/roles/onboarding on the trigger-created public.users rows.
-- `roles` drives actual dashboard routing/authorization; `role` only matters
-- for current_user_role()-based RLS and the admin bypass in
-- app/coordinator/page.tsx. institution is set on author+coordinator so a
-- same-institution org-coordinator-approval flow is exercisable locally
-- (public.is_org_coordinator_for_document() requires coordinator.institution
-- to match the document author's institution).
UPDATE public.users SET
  role = 'reviewer', roles = ARRAY['reviewer'], onboarding_completed = true
WHERE id = '00000000-0000-0000-0000-000000000101';

UPDATE public.users SET
  role = 'author', roles = ARRAY['author'], onboarding_completed = true,
  institution = 'Test University'
WHERE id = '00000000-0000-0000-0000-000000000102';

UPDATE public.users SET
  role = 'reviewer', roles = ARRAY['coordinator'], onboarding_completed = true,
  institution = 'Test University'
WHERE id = '00000000-0000-0000-0000-000000000103';

-- Mirrors the two real admin accounts observed in the production export
-- (role='admin' paired with roles={coordinator}, not {reviewer}) — there is
-- no dedicated /admin route in the app; 'admin' only elevates RLS and the
-- coordinator-page bypass (app/coordinator/page.tsx), so it needs a roles[]
-- entry to land anywhere past onboarding.
UPDATE public.users SET
  role = 'admin', roles = ARRAY['coordinator'], onboarding_completed = true
WHERE id = '00000000-0000-0000-0000-000000000104';
