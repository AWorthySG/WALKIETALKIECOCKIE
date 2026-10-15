export function installPlatform(userAgent = '', platform = '', touchPoints = 0) {
  if (/iPad|iPhone|iPod/i.test(userAgent) || platform === 'MacIntel' && touchPoints > 1) return 'ios';
  if (/Android/i.test(userAgent)) return 'android';
  return 'desktop';
}
export function isStandalone(displayMode, navigatorStandalone) {
  return !!displayMode || navigatorStandalone === true;
}
