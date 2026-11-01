export type SiteId = 'youtube' | 'ytmusic';

export interface SiteInfo {
  id: SiteId;
  label: string;
  home: string;
  /** Instagram refuses to be shown inside another page, so it only opens in its own window. */
  embeddable: boolean;
}

export const SITES: SiteInfo[] = [
  { id: 'youtube', label: 'YOUTUBE', home: 'https://www.youtube.com/', embeddable: true },
  { id: 'ytmusic', label: 'YT MUSIC', home: 'https://music.youtube.com/', embeddable: true },
];

/** Turns a pasted YouTube / YouTube Music link into an embeddable player address, or null. */
export function toYoutubeEmbed(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, '');
  let video: string | null = null;
  if (host === 'youtu.be') video = url.pathname.slice(1);
  else if (host === 'youtube.com' || host === 'music.youtube.com' || host === 'm.youtube.com') {
    video = url.searchParams.get('v') ?? url.pathname.match(/^\/(?:embed|shorts)\/([\w-]+)/)?.[1] ?? null;
  }
  const list = host.endsWith('youtube.com') ? url.searchParams.get('list') : null;
  const idOk = video && /^[\w-]{6,20}$/.test(video);
  if (idOk) {
    const query = list && /^[\w-]+$/.test(list) ? `?list=${list}&autoplay=1` : '?autoplay=1';
    return `https://www.youtube-nocookie.com/embed/${video}${query}`;
  }
  if (list && /^[\w-]+$/.test(list)) {
    return `https://www.youtube-nocookie.com/embed/videoseries?list=${list}&autoplay=1`;
  }
  return null;
}
