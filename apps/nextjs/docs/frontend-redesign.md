# Skill Passport frontend redesign

The frontend now uses an original passport/voice/verification SVG identity, a restrained indigo palette, shared controls and accessible responsive layouts. Existing routes, server actions, authentication decisions, recording lifecycle, scoring and language detection are preserved.

## Review findings and changes

- Replaced the hidden mobile navigation and expanding desktop rail with persistent, labelled navigation.
- Added branded sign-in/sign-up layouts, a reusable full logo and compact mark, SVG favicon and application metadata.
- Refined overview statistics, creation guidance, interview lists, report lists and the share dialog.
- Added candidate headers, an entry step indicator, clearer device/consent layout, recording timer styling, processing feedback and completion styling.
- Improved report hierarchy and retained labelled skill bars on small screens, including unassessed states.
- Fixed the circular font variable, added self-hosted Noto Sans Devanagari alongside Inter and retained system fallbacks for other scripts.
- Improved focus, touch targets, field-error associations, live feedback, semantic headings, skip links and reduced-motion handling. Added a root loading state and retryable error boundary.

## Validation

- Prettier formatting and check, application ESLint, TypeScript checking and the production build pass.
- Live local Chrome review: login, signup, global not-found and candidate unavailable pages at 1440, 768, 390 and 320 pixels; no horizontal page overflow or browser rendering errors.
- Isolated browser review using the real UI components with sample data: overview, empty overview, interviews, reports, share dialog, candidate entry, instructions, active interview, processing, failed answer, language selection and completed report at the same four widths; no horizontal page overflow.
- Hindi and Marathi instructions, interview and completed-report layouts reviewed at 390 pixels. Devanagari text, language choices and skill labels render without clipping. The multilingual briefing also includes Tamil text.
- Checked native dialog keyboard containment and Escape dismissal, clipboard denial fallback, language-list keyboard handling and focus return, device/consent enablement with stubbed devices, reduced motion, live empty-login validation and focus indication.
- Temporary browser fixtures were removed. No accounts, interviews, attempts or recordings were created for visual review.

## Limits

Protected screens were visually checked with isolated sample data, not a live authenticated session. Real microphone/camera capture, audio playback, uploads, AI processing, report downloads and full interview completion were not exercised end to end. Physical iOS/Android devices and browsers other than desktop Chrome were not tested. Existing English-only admin/candidate entry copy remains English; existing translated dictionaries and language behavior were preserved.

## Changed files

Paths below are relative to `apps/nextjs`. Only frontend presentation and this review document changed.

- `src/app/(admin)/admin/create-interview.tsx`
- `src/app/(admin)/admin/interview-dialog.tsx`
- `src/app/(admin)/admin/interviews/page.tsx`
- `src/app/(admin)/admin/page.tsx`
- `src/app/(admin)/admin/reports/page.tsx`
- `src/app/(admin)/admin/share-link.tsx`
- `src/app/(admin)/admin/sidebar.tsx`
- `src/app/(admin)/layout.tsx`
- `src/app/(auth)/login/login-form.tsx`
- `src/app/(auth)/login/page.tsx`
- `src/app/(auth)/signup/page.tsx`
- `src/app/(auth)/signup/signup-form.tsx`
- `src/app/attempt/[attemptId]/active-interview.tsx`
- `src/app/attempt/[attemptId]/instructions.tsx`
- `src/app/attempt/[attemptId]/language-picker.tsx`
- `src/app/attempt/[attemptId]/loading.tsx`
- `src/app/attempt/[attemptId]/not-found.tsx`
- `src/app/attempt/[attemptId]/page.tsx`
- `src/app/attempt/[attemptId]/result/page.tsx`
- `src/app/attempt/layout.tsx`
- `src/app/error.tsx`
- `src/app/globals.css`
- `src/app/i/[token]/page.tsx`
- `src/app/i/[token]/start-form.tsx`
- `src/app/i/layout.tsx`
- `src/app/icon.svg`
- `src/app/layout.tsx`
- `src/app/loading.tsx`
- `src/app/not-found.tsx`
- `src/components/attempt-report.tsx`
- `src/components/auth-shell.tsx`
- `src/components/brand.tsx`
- `src/components/modal.tsx`
- `src/components/ui/icon.tsx`
- `src/components/ui/index.tsx`
- `docs/frontend-redesign.md`
