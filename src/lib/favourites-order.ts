import type { Favourite } from '@/types/models';

/**
 * Favourites ki user-defined tartib (reorder). Legacy entries (baghair
 * sortOrder) createdAt se sort hoti hain; reorder ke baad har entry ko
 * explicit sortOrder mil jata hai. Nai favourite hamesha aakhir me aati hai.
 */
export function sortFavourites(favs: readonly Favourite[]): Favourite[] {
  return [...favs].sort((a, b) => {
    const ao = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const bo = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return a.createdAt - b.createdAt;
  });
}

/** Drag-end par naya order: itemIds ki tartib me sortOrder = index. Jo ids list me nahi, wo aakhir me rehti hain. */
export function applyFavouriteOrder(favs: readonly Favourite[], orderedItemIds: readonly string[]): Favourite[] {
  const pos = new Map(orderedItemIds.map((id, i) => [id, i]));
  const FAR = Number.MAX_SAFE_INTEGER - 1_000_000;
  return sortFavourites(favs).map((f) => ({ ...f, sortOrder: pos.get(f.itemId) ?? FAR + Math.floor(f.createdAt / 1000) }));
}

export function nextSortOrder(favs: readonly Favourite[]): number {
  return favs.reduce((m, f) => Math.max(m, f.sortOrder ?? -1), -1) + 1;
}
