import { useEffect } from 'react';

/** Apna production domain yahan rakhein (sitemap/robots/rss isi se bante hain). */
export const SITE_URL = 'https://siravex.vercel.app';
export const SITE_NAME = 'SIRAVEX — Premium IPTV & Universal Media Player';

/** Har page ka title + description + OpenGraph (Google/social sharing ke liye). */
export function usePageMeta(title: string, description: string): void {
  useEffect(() => {
    document.title = title;
    const set = (sel: string, attr: string, key: string, val: string) => {
      let el = document.head.querySelector(sel) as HTMLMetaElement | null;
      if (!el) { el = document.createElement('meta'); el.setAttribute(attr, key); document.head.appendChild(el); }
      el.setAttribute('content', val);
    };
    set('meta[name="description"]', 'name', 'description', description);
    set('meta[property="og:title"]', 'property', 'og:title', title);
    set('meta[property="og:description"]', 'property', 'og:description', description);
    set('meta[name="twitter:title"]', 'name', 'twitter:title', title);
    set('meta[name="twitter:description"]', 'name', 'twitter:description', description);
  }, [title, description]);
}
