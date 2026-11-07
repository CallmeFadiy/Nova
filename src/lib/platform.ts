export const isAndroid =
  typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

export const isMobile = isAndroid;
