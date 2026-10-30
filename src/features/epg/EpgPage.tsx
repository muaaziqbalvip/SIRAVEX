import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, BellRing, CalendarRange, ChevronLeft, ChevronRight, List, Play } from 'lucide-react';
import { useStore } from '@/app/store';
import { Button, Card, EmptyState, Skeleton } from '@/components/ui/ui';
import { SafeImage } from '@/components/media/MediaCard';
import { MzAdSlot } from '@/components/ads/MzAdSlot';
import { cleanTitle } from '@/lib/display';
import { isMediaLocked } from '@/lib/parental';
import { matchesChannelEpg, nowAndNextForItem } from '@/services/epg/xmltv';

export function EpgPage() {
  const {
    ready, items, playlists, programmes, settings, parentalUnlocked,
    reminders, toggleReminder, hasReminder, importEpg, refreshXtreamEpg, toast,
  } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [viewMode, setViewMode] = useState<'matrix' | 'single'>('matrix');
  const [q, setQ] = useState('');
  const [chFilter, setChFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [epgPass, setEpgPass] = useState<Record<string, string>>({});
  const [windowOffsetMin, setWindowOffsetMin] = useState(0);

  const xtreamSources = playlists.filter((p) => p.type === 'xtream');
  const fetchFromXtream = async (playlistId: string) => {
    setBusy(true);
    try {
      const n = await refreshXtreamEpg(playlistId, epgPass[playlistId] || undefined);
      toast({ tone: 'success', title: `EPG updated: ${n.toLocaleString()} programmes` });
    } catch (e) {
      toast({ tone: 'error', title: 'EPG fetch failed', body: e instanceof Error ? e.message : 'Failed' });
    } finally {
      setBusy(false);
    }
  };

  const enabled = useMemo(() => new Set(playlists.filter((p) => p.enabled).map((p) => p.id)), [playlists]);
  const live = useMemo(
    () => items.filter((i) => i.kind === 'live' && enabled.has(i.playlistId) && !isMediaLocked(i, settings, parentalUnlocked)),
    [items, enabled, settings, parentalUnlocked],
  );

  const [selectedId, setSelectedId] = useState<string>('');
  const selected = live.find((i) => i.id === selectedId) ?? live[0];
  const schedule = useMemo(
    () =>
      selected
        ? programmes
            .filter((p) => matchesChannelEpg(p.channelId, selected) && p.title.toLowerCase().includes(q.toLowerCase()))
            .sort((a, b) => a.start - b.start)
            .slice(0, 60)
        : [],
    [programmes, selected, q],
  );
  const nn = selected ? nowAndNextForItem(programmes, selected) : {};

  // Multi-channel timeline window: 3 hours wide (6 x 30m slots), aligned to nearest 30m boundary
  const now = Date.now();
  const baseHalfHour = Math.floor(now / 1_800_000) * 1_800_000;
  const winStart = baseHalfHour + windowOffsetMin * 60_000;
  const winDurationMs = 3 * 3_600_000; // 3 hours
  const winEnd = winStart + winDurationMs;
  const nowPct = ((now - winStart) / winDurationMs) * 100;

  const matrixChannels = useMemo(() => {
    const f = chFilter.trim().toLowerCase();
    return live
      .filter((c) => !f || c.title.toLowerCase().includes(f) || c.group.toLowerCase().includes(f))
      .slice(0, 45);
  }, [live, chFilter]);

  const progsByChannelKey = useMemo(() => {
    const map = new Map<string, typeof programmes>();
    for (const p of programmes) {
      if (p.end <= winStart || p.start >= winEnd) continue;
      const key = p.channelId.trim().toLowerCase();
      if (!key) continue;
      const arr = map.get(key);
      if (arr) arr.push(p);
      else map.set(key, [p]);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.start - b.start);
    return map;
  }, [programmes, winStart, winEnd]);

  if (!ready) return <Skeleton className="h-64" />;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h1 className="text-xl font-extrabold sm:text-2xl">TV Programme Guide (EPG)</h1>
          {reminders.length > 0 && (
            <p className="text-xs text-amber-300">
              <BellRing size={12} className="mr-1 inline" aria-hidden />
              {reminders.length} active programme reminder(s) scheduled
            </p>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setViewMode('matrix')}
            aria-pressed={viewMode === 'matrix'}
            className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-full px-3.5 text-xs font-extrabold ${
              viewMode === 'matrix' ? 'bg-sky-500 text-white shadow-glow' : 'border border-border bg-card text-silver'
            }`}
          >
            <CalendarRange size={14} aria-hidden />Timeline Grid
          </button>
          <button
            type="button"
            onClick={() => setViewMode('single')}
            aria-pressed={viewMode === 'single'}
            className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-full px-3.5 text-xs font-extrabold ${
              viewMode === 'single' ? 'bg-sky-500 text-white shadow-glow' : 'border border-border bg-card text-silver'
            }`}
          >
            <List size={14} aria-hidden />Channel List
          </button>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".xml,text/xml"
          className="sr-only"
          aria-label="Import XMLTV EPG file"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            setBusy(true);
            try {
              const r = await importEpg(f);
              toast({ tone: 'success', title: `EPG imported: ${r.count} programmes`, body: r.warnings[0] });
            } catch (err) {
              toast({ tone: 'error', title: 'EPG import failed', body: err instanceof Error ? err.message : 'Invalid EPG file' });
            } finally {
              setBusy(false);
            }
          }}
        />
        <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy ? 'Importing…' : 'Import XMLTV'}
        </Button>
      </div>

      {xtreamSources.length > 0 && (
        <div className="mb-4 grid gap-2">
          {xtreamSources.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-2xl border border-sky-500/40 bg-sky-950/30 p-3">
              <p className="min-w-[200px] flex-1 text-sm">
                <strong>{p.name}</strong>
                <span className="block text-xs text-muted">
                  Xtream EPG {programmes.filter((x) => x.playlistId === p.id).length.toLocaleString()} programmes
                  {p.lastEpgAt ? ` · updated ${new Date(p.lastEpgAt).toLocaleString()}` : ' · abhi fetch nahi hua'}
                </span>
              </p>
              {!p.password && (
                <input
                  type="password"
                  value={epgPass[p.id] ?? ''}
                  onChange={(e) => setEpgPass((s) => ({ ...s, [p.id]: e.target.value }))}
                  placeholder="Account password"
                  autoComplete="current-password"
                  className="min-h-[42px] w-44 rounded-xl border border-border bg-ink px-3 text-sm focus:border-sky-400 focus:outline-none"
                />
              )}
              <Button disabled={busy} onClick={() => void fetchFromXtream(p.id)}>
                {busy ? 'Fetching…' : 'Fetch EPG from Xtream'}
              </Button>
            </div>
          ))}
        </div>
      )}

      {programmes.length === 0 ? (
        <EmptyState
          title="No EPG data yet"
          body="Xtream users: upar wala Fetch EPG button dabayein — guide seedha provider ke xmltv.php se ayega. Ya apni XMLTV (.xml) file import karein."
          action={<Button onClick={() => fileRef.current?.click()}>Import XMLTV</Button>}
        />
      ) : viewMode === 'matrix' ? (
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              value={chFilter}
              onChange={(e) => setChFilter(e.target.value)}
              placeholder={`Filter ${live.length} channels…`}
              aria-label="Filter guide channels"
              className="min-h-[42px] min-w-[200px] flex-1 rounded-xl border border-border bg-panel px-3.5 text-sm focus:border-sky-400 focus:outline-none"
            />
            <div className="flex items-center gap-1">
              <Button variant="outline" className="min-h-[40px] px-3 text-xs" onClick={() => setWindowOffsetMin((m) => m - 60)}>
                <ChevronLeft size={15} aria-hidden />−1h
              </Button>
              <Button variant="outline" className="min-h-[40px] px-3 text-xs" onClick={() => setWindowOffsetMin(0)}>
                Now
              </Button>
              <Button variant="outline" className="min-h-[40px] px-3 text-xs" onClick={() => setWindowOffsetMin((m) => m + 60)}>
                +1h<ChevronRight size={15} aria-hidden />
              </Button>
            </div>
          </div>

          <MzAdSlot slot="banner" placement="epg" compact className="mb-3" />

          {/* Broadcast Multi-Channel Timeline Matrix */}
          <div className="overflow-x-auto rounded-2xl border border-border bg-panel shadow-card">
            <div className="min-w-[820px]">
              {/* Time Ruler Header */}
              <div className="grid grid-cols-[210px_1fr] border-b border-border bg-ink/85 text-xs font-bold text-muted">
                <div className="px-3 py-2.5 text-silver">Channel ({matrixChannels.length})</div>
                <div className="relative grid grid-cols-6 divide-x divide-border/70">
                  {Array.from({ length: 6 }, (_, idx) => {
                    const slotTime = winStart + idx * 1_800_000;
                    return (
                      <div key={idx} className="px-2.5 py-2.5 font-mono text-[11px]">
                        {new Date(slotTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    );
                  })}
                  {nowPct >= 0 && nowPct <= 100 && (
                    <span
                      className="pointer-events-none absolute bottom-0 top-0 z-10 w-0.5 bg-red-500"
                      style={{ left: `${nowPct}%` }}
                      aria-hidden
                    />
                  )}
                </div>
              </div>

              {/* Channel Rows */}
              <div className="divide-y divide-border/70">
                {matrixChannels.map((ch) => {
                  const k1 = (ch.tvgId ?? '').trim().toLowerCase();
                  const k2 = ch.id.trim().toLowerCase();
                  const k3 = ch.title.trim().toLowerCase();
                  const chProgs = (k1 && progsByChannelKey.get(k1)) || progsByChannelKey.get(k2) || progsByChannelKey.get(k3) || [];
                  return (
                    <div key={ch.id} className="grid grid-cols-[210px_1fr] items-stretch hover:bg-white/[0.02]">
                      <Link
                        to={`/player/${encodeURIComponent(ch.id)}`}
                        className="flex items-center gap-2.5 border-r border-border/70 px-3 py-2 text-left hover:bg-sky-500/10"
                      >
                        <span className="grid h-8 w-10 shrink-0 place-items-center overflow-hidden rounded bg-card p-0.5">
                          <SafeImage src={ch.logo} title={ch.title} contain className="max-h-full max-w-full" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-bold text-silver">{cleanTitle(ch.title)}</span>
                          <span className="block truncate text-[10px] text-cyanx">Watch Live →</span>
                        </span>
                      </Link>

                      <div className="relative h-14 bg-card/35">
                        {nowPct >= 0 && nowPct <= 100 && (
                          <span
                            className="pointer-events-none absolute bottom-0 top-0 z-10 w-0.5 bg-red-500/75"
                            style={{ left: `${nowPct}%` }}
                            aria-hidden
                          />
                        )}
                        {chProgs.length === 0 ? (
                          <div className="flex h-full items-center px-3 text-[11px] text-muted/60">
                            No guide data in this 3h window
                          </div>
                        ) : (
                          chProgs.map((pr) => {
                            const left = Math.max(0, ((pr.start - winStart) / winDurationMs) * 100);
                            const right = Math.min(100, ((pr.end - winStart) / winDurationMs) * 100);
                            const width = Math.max(4, right - left);
                            const isLive = now >= pr.start && now < pr.end;
                            const isFuture = pr.start > now;
                            const rem = hasReminder(pr.id);
                            return (
                              <div
                                key={pr.id}
                                style={{ left: `${left}%`, width: `${width}%` }}
                                title={`${cleanTitle(pr.title)} (${new Date(pr.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – ${new Date(pr.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`}
                                className={`absolute bottom-1 top-1 flex items-center justify-between gap-1 overflow-hidden rounded-lg border px-2 text-xs ${
                                  isLive
                                    ? 'border-sky-400/60 bg-sky-950/85 text-white'
                                    : 'border-border bg-panel/90 text-silver/90'
                                }`}
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-[11px] font-bold">{cleanTitle(pr.title)}</p>
                                  <p className="truncate font-mono text-[10px] text-muted">
                                    {new Date(pr.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </p>
                                </div>
                                {isFuture && width >= 12 && (
                                  <button
                                    type="button"
                                    onClick={() => toggleReminder(pr, ch)}
                                    title={rem ? 'Cancel reminder' : 'Set reminder when show starts'}
                                    aria-label={`Remind me: ${pr.title}`}
                                    className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${
                                      rem ? 'bg-amber-500/25 text-amber-300' : 'text-muted hover:bg-white/10 hover:text-white'
                                    }`}
                                  >
                                    {rem ? <BellRing size={12} /> : <Bell size={12} />}
                                  </button>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted">
            Red vertical needle marks current live time. Kisi bhi upcoming show par bell (<Bell size={11} className="inline" />) dabayein taake show shuru hote hi notification mil jaye.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <Card className="max-h-[70vh] overflow-y-auto">
            <h2 className="mb-2 font-bold">Channels</h2>
            <div className="grid gap-1">
              {live.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  aria-pressed={selected?.id === c.id}
                  className={`min-h-[44px] rounded-lg px-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx ${
                    selected?.id === c.id ? 'bg-sky-500 text-white' : 'hover:bg-panel'
                  }`}
                >
                  {c.title}
                  <span className="block text-xs opacity-75">{c.tvgId || 'no tvg-id'}</span>
                </button>
              ))}
            </div>
          </Card>

          <div className="min-w-0">
            {selected && (
              <Card className="mb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-bold">{selected.title}</h2>
                  <Link to={`/player/${encodeURIComponent(selected.id)}`}>
                    <Button className="min-h-[38px] px-3.5 text-xs"><Play size={15} aria-hidden />Watch Live</Button>
                  </Link>
                </div>
                {nn.current ? (
                  <p className="mt-1 text-sm">
                    <span className="font-semibold text-cyanx">Now:</span> {nn.current.title} ({new Date(nn.current.start).toLocaleTimeString()}–{new Date(nn.current.end).toLocaleTimeString()})
                    <span className="mt-2 block h-2 overflow-hidden rounded bg-slate-800">
                      <span className="block h-full bg-sky-400" style={{ width: `${Math.min(100, ((Date.now() - nn.current.start) / Math.max(1, nn.current.end - nn.current.start)) * 100)}%` }} />
                    </span>
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-muted">No current programme in the imported data for this channel right now.</p>
                )}
                {nn.next && <p className="mt-1 text-sm text-muted">Next: {nn.next.title} at {new Date(nn.next.start).toLocaleTimeString()}</p>}
                <label className="sr-only" htmlFor="epg-q">Search programmes</label>
                <input
                  id="epg-q"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search programme titles…"
                  className="mt-3 min-h-[44px] w-full rounded-xl border border-border bg-ink px-3 text-sm focus:border-sky-400 focus:outline-none"
                />
              </Card>
            )}

            <MzAdSlot slot="banner" placement="epg" compact className="mb-3" />

            <div className="relative overflow-x-auto rounded-2xl border border-border" role="region" aria-label="Schedule timeline">
              {schedule.length === 0 ? (
                <p className="p-5 text-sm text-muted">
                  No programmes match this channel/search in the imported window. <Link to="/playlists" className="text-cyanx hover:underline">Check your EPG import</Link>.
                </p>
              ) : (
                <ol className="min-w-[520px] divide-y divide-border">
                  {schedule.map((p) => {
                    const isFuture = p.start > now;
                    const rem = hasReminder(p.id);
                    return (
                      <li key={p.id} className={`flex items-center justify-between gap-3 px-4 py-3 text-sm ${now >= p.start && now < p.end ? 'bg-sky-950/50' : 'bg-card'}`}>
                        <div className="min-w-0 flex-1">
                          <span className="font-semibold">{p.title}</span>
                          <span className="block text-xs text-muted">
                            {new Date(p.start).toLocaleString()} – {new Date(p.end).toLocaleTimeString()}
                            {p.description ? ` · ${p.description}` : ''}
                          </span>
                        </div>
                        {isFuture && selected && (
                          <Button variant="outline" className="min-h-[34px] shrink-0 px-2.5 text-xs" onClick={() => toggleReminder(p, selected)}>
                            {rem ? <BellRing size={13} className="text-amber-300" /> : <Bell size={13} />}
                            {rem ? 'Reminder Set' : 'Remind'}
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
