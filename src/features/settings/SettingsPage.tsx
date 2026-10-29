import { useState } from 'react';
import { useStore } from '@/app/store';
import { clearAllCachesAndReload } from '@/lib/update';
import { Button, Card, ConfirmDialog, Select, Switch } from '@/components/ui/ui';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <Card className="mb-4"><h2 className="mb-4 text-lg font-bold">{title}</h2><div className="grid gap-4">{children}</div></Card>;
}
function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3"><div className="min-w-[220px] flex-1"><span className="font-medium">{label}</span>{hint && <p className="mt-0.5 text-xs leading-5 text-muted">{hint}</p>}</div>{children}</div>;
}

export function SettingsPage() {
  const { settings, updateSettings, resetSettings, clearHistory, clearLocalData, exportSettings, toast, playlists, setDefaultPlaylist } = useStore();
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  return (
    <div className="mx-auto max-w-4xl"><h1 className="mb-1 text-2xl font-extrabold">Settings</h1><p className="mb-5 text-sm text-muted">Every control changes real state and persists locally where the browser allows it. Reset and destructive actions always ask first.</p>
      <Section title="Appearance">
        <Row label="Theme"><Select value={settings.theme} onChange={(e) => updateSettings({ theme: e.target.value as typeof settings.theme })} aria-label="Theme"><option value="dark">Dark</option><option value="light">Light</option><option value="system">System</option></Select></Row>
        <Row label="Accent colour"><Select value={settings.accent} onChange={(e) => updateSettings({ accent: e.target.value as typeof settings.accent })} aria-label="Accent colour"><option value="sky">Electric Blue</option><option value="cyan">Cyan</option><option value="violet">Violet</option><option value="emerald">Emerald</option></Select></Row>
        <Row label="Density"><Select value={settings.density} onChange={(e) => updateSettings({ density: e.target.value as typeof settings.density })} aria-label="Density"><option value="comfortable">Comfortable</option><option value="compact">Compact</option></Select></Row>
        <Row label="Reduced motion" hint="Also honoured from your operating system via CSS."><Switch checked={settings.reducedMotion} onChange={(v) => updateSettings({ reducedMotion: v })} label="Reduced motion" /></Row>
        <Row label="Live TV layout"><Select value={settings.liveLayout} onChange={(e) => updateSettings({ liveLayout: e.target.value as typeof settings.liveLayout })} aria-label="Live TV layout"><option value="list">List</option><option value="grid">Grid</option></Select></Row>
      </Section>
      <Section title="Playback">
        <Row label="Mizanora ads" hint="Mizanora (hamari apni shop) ki offers home aur player par dikhti hain — SIRAVEX ko free rakhne me madad milti hai. Band karne se banners aur pre-roll dono ruk jate hain."><Switch checked={settings.showAds} onChange={(v) => updateSettings({ showAds: v })} label="Mizanora ads" /></Row>
        <Row label="Autoplay" hint="Browsers may still require a tap for sound. SIRAVEX never autoplays with sound against browser policy."><Switch checked={settings.autoplay} onChange={(v) => updateSettings({ autoplay: v })} label="Autoplay" /></Row>
        <Row label="Resume playback"><Switch checked={settings.resumePlayback} onChange={(v) => updateSettings({ resumePlayback: v })} label="Resume playback" /></Row>
        <Row label="Default volume"><input type="range" min={0} max={1} step={0.05} value={settings.defaultVolume} onChange={(e) => updateSettings({ defaultVolume: Number(e.target.value) })} aria-label="Default volume" className="w-44 accent-sky-400" /><span className="text-sm text-muted">{Math.round(settings.defaultVolume * 100)}%</span></Row>
        <Row label="Playback speed"><Select value={settings.playbackSpeed} onChange={(e) => updateSettings({ playbackSpeed: Number(e.target.value) })} aria-label="Default playback speed">{[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => <option key={r} value={r}>{r}×</option>)}</Select></Row>
        <Row label="Preferred audio language" hint="Used as your preference label; actual track switching happens in the player when tracks exist."><Select value={settings.audioLanguage} onChange={(e) => updateSettings({ audioLanguage: e.target.value })} aria-label="Preferred audio language"><option value="">No preference</option><option value="en">English</option><option value="ur">Urdu</option><option value="hi">Hindi</option><option value="ar">Arabic</option><option value="es">Spanish</option></Select></Row>
        <Row label="Preferred subtitle language"><Select value={settings.subtitleLanguage} onChange={(e) => updateSettings({ subtitleLanguage: e.target.value })} aria-label="Preferred subtitle language"><option value="">No preference</option><option value="en">English</option><option value="ur">Urdu</option><option value="hi">Hindi</option><option value="ar">Arabic</option><option value="es">Spanish</option></Select></Row>
        <Row label="Subtitle size"><Select value={settings.subtitleSize} onChange={(e) => updateSettings({ subtitleSize: e.target.value as typeof settings.subtitleSize })} aria-label="Subtitle size"><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></Select></Row>
        <Row label="Subtitle colour"><input type="color" value={settings.subtitleColor} onChange={(e) => updateSettings({ subtitleColor: e.target.value })} aria-label="Subtitle colour" className="h-11 w-16 cursor-pointer rounded border border-border bg-panel" /></Row>
      </Section>
      <Section title="Library & Accessibility">
        <Row label="Default home section"><Select value={settings.defaultHome} onChange={(e) => updateSettings({ defaultHome: e.target.value })} aria-label="Default home section"><option value="/">Home</option><option value="/live">Live TV</option><option value="/movies">Movies</option><option value="/favourites">Favourites</option></Select></Row>
        <Row label="Default playlist"><Select value={playlists.find((p) => p.isDefault)?.id ?? ''} onChange={(e) => { if (e.target.value) void setDefaultPlaylist(e.target.value); }} aria-label="Default playlist"><option value="">No default</option>{playlists.map((p) => <option key={p.id} value={p.id}>{p.name}{p.isDefault ? ' — default' : ''}</option>)}</Select></Row>
        <Row label="Save recent searches"><Switch checked={settings.saveRecentSearches} onChange={(v) => updateSettings({ saveRecentSearches: v })} label="Save recent searches" /></Row>
        <div className="rounded-xl border border-border bg-panel p-4 text-sm leading-6"><p className="font-bold">Keyboard shortcuts</p><ul className="mt-1 list-disc pl-5 text-muted"><li>Space — play/pause (never while typing)</li><li>← / → — seek 10s on seekable media</li><li>↑ / ↓ — browser volume in player focus</li><li>M — mute · F — fullscreen · Esc — close panels</li></ul></div>
      </Section>
      <Section title="Privacy & Storage">
        <p className="text-sm leading-6 text-muted">SIRAVEX stores playlists, items, EPG, favourites, progress and settings <strong className="text-silver">only on this device</strong> (IndexedDB + local settings). There is no account, no analytics and no server upload. Playlist URLs can contain private tokens — SIRAVEX shows only the host, never logs full URLs, and exports exclude URLs and all credentials by default. “Remove saved credentials” means disconnecting sources below, because passwords are never persisted.</p>
        <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void clearHistory().then(() => toast({ tone: 'success', title: 'History cleared' }))}>Clear history</Button><Button variant="outline" onClick={exportSettings}>Export settings (no secrets)</Button><Button variant="outline" onClick={() => void clearAllCachesAndReload()}>Clear app cache & reload</Button><Button variant="danger" onClick={() => setConfirmClear(true)}>Clear cached metadata & all local data</Button></div>
      </Section>
      <Section title="Reset">
        <Row label="Reset all settings to defaults"><Button variant="danger" onClick={() => setConfirmReset(true)}>Reset settings…</Button></Row>
      </Section>
      <ConfirmDialog open={confirmReset} title="Reset settings?" body="Appearance, playback and library preferences return to defaults. Playlists, favourites and history are kept." confirmLabel="Reset settings" onCancel={() => setConfirmReset(false)} onConfirm={() => { resetSettings(); setConfirmReset(false); toast({ tone: 'success', title: 'Settings reset' }); }} />
      <ConfirmDialog open={confirmClear} title="Clear all local data?" body="This deletes playlists, imported items, EPG, favourites, progress and diagnostics from this device. Export your settings first if needed." confirmLabel="Clear everything" onCancel={() => setConfirmClear(false)} onConfirm={async () => { await clearLocalData(); setConfirmClear(false); toast({ tone: 'success', title: 'Local data cleared' }); }} />
    </div>
  );
}
