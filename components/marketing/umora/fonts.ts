import localFont from "next/font/local";

// Self-hosted so the build never needs network access. Both typefaces are
// licensed under the SIL Open Font License 1.1 (see ./fonts/OFL-*.txt).

export const umoraSans = localFont({
  src: "./fonts/Montserrat-latin.woff2",
  weight: "400 800",
  style: "normal",
  display: "swap",
  variable: "--font-umora-sans",
});

export const umoraScript = localFont({
  src: "./fonts/Caveat-latin.woff2",
  weight: "500 700",
  style: "normal",
  display: "swap",
  variable: "--font-umora-script",
});
