# Vendored fonts

Ownloom Gateway Web self-hosts the core Digital Scoarță typefaces so the cockpit can keep `Content-Security-Policy: style-src 'self'` and avoid runtime calls to Google Fonts or any other remote asset host.

Fonts:

- Newsreader variable TTF — headings/editorial surfaces, SIL Open Font License 1.1.
- Work Sans variable TTF — body/interface text, SIL Open Font License 1.1.
- JetBrains Mono variable WOFF2 — labels, chips, logs, and technical metadata, SIL Open Font License 1.1.

These font families are available from Google Fonts / upstream projects under the SIL Open Font License 1.1; see `OFL.txt`. Keep this directory small: only include the weights/styles used by `public/styles/tokens.css`.
