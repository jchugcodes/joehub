/** "back" uses the session history. "/tasks" is the direct-load fallback. */
export function settingsBack(referrer, historyLength, origin) {
  let sameOrigin = false;
  try {
    sameOrigin = Boolean(referrer) && new URL(referrer).origin === origin;
  } catch {
    sameOrigin = false;
  }
  if (sameOrigin) return "back";
  // A client navigation does not set a referrer. An extra history entry with
  // an empty referrer is that in-app visit. An outside referrer is a direct load.
  if (!referrer && historyLength > 1) return "back";
  return "/tasks";
}
