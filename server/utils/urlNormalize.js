function normalizeUrl(rawUrl, type = 'reel') {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { valid: false, reason: 'Empty or missing URL' };
  }

  let cleaned = rawUrl.trim();
  if (!cleaned) {
    return { valid: false, reason: 'Empty URL' };
  }

  // Remove query parameters (?igshid=...)
  const queryIndex = cleaned.indexOf('?');
  if (queryIndex !== -1) {
    cleaned = cleaned.substring(0, queryIndex);
  }

  // Strip hash parameters
  const hashIndex = cleaned.indexOf('#');
  if (hashIndex !== -1) {
    cleaned = cleaned.substring(0, hashIndex);
  }

  // Remove trailing slashes
  cleaned = cleaned.replace(/\/+$/, '');

  // Ensure https://
  if (!/^https?:\/\//i.test(cleaned)) {
    if (/^www\./i.test(cleaned) || /^instagram\.com/i.test(cleaned)) {
      cleaned = 'https://' + cleaned;
    } else {
      // If it's just a username for profile or shortcode
      if (type === 'profile' && !cleaned.includes('/')) {
        cleaned = `https://www.instagram.com/${cleaned}`;
      } else if (type === 'reel' && !cleaned.includes('/') && cleaned.length > 5) {
        cleaned = `https://www.instagram.com/reel/${cleaned}`;
      } else {
        return { valid: false, reason: 'Invalid URL format' };
      }
    }
  }

  // Parse URL
  try {
    const parsed = new URL(cleaned);
    const hostname = parsed.hostname.toLowerCase();
    if (!hostname.includes('instagram.com') && !hostname.includes('instagr.am')) {
      return { valid: false, reason: 'Must be an Instagram URL' };
    }

    const pathname = parsed.pathname.replace(/\/+$/, '');

    if (type === 'reel') {
      // Matches /reel/{code}, /reels/{code}, /p/{code}
      const reelRegex = /^\/(reel|reels|p)\/([a-zA-Z0-9_-]+)$/;
      const match = pathname.match(reelRegex);
      if (!match) {
        return { valid: false, reason: 'Not an Instagram reel or post link' };
      }
      const shortcode = match[2];
      const normalized = `https://www.instagram.com/reel/${shortcode}`;
      return { valid: true, normalized, shortcode };
    } else if (type === 'profile') {
      // Matches /{username} or /{username}/...
      const segments = pathname.split('/').filter(Boolean);
      if (segments.length === 0) {
        return { valid: false, reason: 'Invalid profile username' };
      }
      const username = segments[0];
      // Exclude generic paths like explore, p, reel, direct, accounts
      const reserved = ['explore', 'p', 'reel', 'reels', 'direct', 'accounts', 'stories', 'tv'];
      if (reserved.includes(username.toLowerCase())) {
        return { valid: false, reason: 'Not a valid creator profile link' };
      }
      const normalized = `https://www.instagram.com/${username}`;
      return { valid: true, normalized, username };
    }

    return { valid: false, reason: 'Unknown link type' };
  } catch (err) {
    return { valid: false, reason: 'Malformed URL' };
  }
}

module.exports = { normalizeUrl };
