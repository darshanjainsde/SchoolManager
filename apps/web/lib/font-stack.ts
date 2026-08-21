/**
 * `SiteProfile.headingFont` → the CSS font stack to apply.
 *
 * Pure data, deliberately separated from `lib/fonts.ts`: that module calls
 * `next/font/google` at import time, which only exists under the Next build,
 * so anything a unit test touches must not import it (3x in the mistake
 * ledger as test-import-drags-next-font). The variables referenced here are
 * defined by `fontVars` from `lib/fonts.ts` on a wrapper element.
 */
export const FONT_STACK: Record<string, string> = {
  INTER: `var(--f-inter), sans-serif`,
  FRAUNCES: `var(--f-fraunces), serif`,
  POPPINS: `var(--f-poppins), sans-serif`,
  NUNITO: `var(--f-nunito), sans-serif`,
  PLAYFAIR: `var(--f-playfair), Georgia, serif`,
  SPACE_GROTESK: `var(--f-space-grotesk), sans-serif`,
  MONTSERRAT: `var(--f-montserrat), sans-serif`,
  LORA: `var(--f-lora), Georgia, serif`,
};
