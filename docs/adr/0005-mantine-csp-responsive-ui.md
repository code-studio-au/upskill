# ADR 0005: Mantine, CSP and responsive UI

## Status

Accepted.

## Decision

Use Mantine normally with CSS Modules and mobile-first CSS. Script CSP never
uses `unsafe-inline`; generated scripts and style elements use a request nonce.
Permit `style-src-attr 'unsafe-inline'` for Mantine's generated CSS variables,
while linting application-authored inline styles.

## Consequences

The application retains Mantine accessibility and responsive behaviour without
rebuilding the component library. CSP tests keep the exception narrow and
prevent it from spreading to scripts or unrestricted style elements.
