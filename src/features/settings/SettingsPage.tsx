import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Lock, LockOpen, RefreshCw, ShieldAlert } from 'lucide-react';
import { useStore } from '@/app/store';
import { useAuth } from '@/services/firebase/AuthContext';
import { hashParentalPin, isValidPinFormat } from '@/lib/parental';
import { VIDEO_PICTURE_PRESET_LIST } from '@/lib/m3u-export';
import { clearAllCachesAndReload } from '@/lib/update';
import { Button, Card, ConfirmDialog, Input, Select, Switch } from '@/components/ui/ui';
import { PinModal } from '@/components/ui/PinModal';
import type { VideoPicturePreset } from '@/types/models';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <Card className="mb-4"><h2 className="mb-4 text-lg font-bold">{title}</h2><div className="grid gap-4">{children}</div></Card>;
}
function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3"><div className="min-w-[220px] flex-1"><span className="font-medium">{label}</span>{hint && <p className="mt-0.5 text-xs leading-5 text-muted">{hint}</p>}</div>{children}</div>;
}

export function SettingsPage() {
  const {
    settings, updateSettings, resetSettings, clearHistory, clearLocalData,
    exportSettings, toast, playlists, items, setDefaultPlaylist,
    cloudSyncState, lastCloudSyncAt, syncCloudNow,
    parentalUnlocked, lockParentalNow, toggleGroupLock,
  } = useStore();
  const { user } = useAuth();

  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [newPin, setNewPin] = useState('');
  const [pinModalOpen, setPinModalOpen] = useState(false);

  const allGroups = useMemo(
    () => Array.from(new Set(items.map((i) => i.group).filter(Boolean))).sort().slice(0, 80),
    [items],
  );

  const savePin = async () => {
    if (!isValidPinFormat(newPin)) {
      toast({ tone: 'error', title: 'Invalid PIN', body: 'PIN 4 se 8 digits (numbers) ka hona chahiye.' });
      return;
    }
    const hash = await hashParentalPin(newPin);
    updateSettings({ parentalPinHash: hash, parentalEnabled: true });
    setNewPin('');
    toast({ tone: 'success', title: 'Parental PIN Saved', body: 'Parental Lock ab active hai.' });
  };

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-1 text-2xl font-extrabold">Settings &amp; Pro Controls</h1>
      <p className="mb-5 text-sm text-muted">
        Cloud Sync, Parental PIN Lock, Video Picture Equalizer, multi-audio defaults aur storage controls.
      </p>

      {/* Firebase Cloud Sync */}
      <Section title="Firebase Cloud Vault Sync">
        <Row
          label="Auto-Sync Playlists & Preferences to Firebase"
          hint={
            user
              ? `Signed in as ${user.email}. Xtream & M3U sources save with client-side AES-256 encryption.${lastCloudSyncAt ? ` Last synced ${new Date(lastCloudSyncAt).toLocaleTimeString()}.` : ''}`
              : 'Sign in with Google or Email so your Xtream & M3U playlists follow you across Mobile, PC and Smart TV.'
          }
        >
          <div className="flex flex-wrap items-center gap-2">
            <Switch
              checked={settings.cloudSyncEnabled}
              onChange={(v) => updateSettings({ cloudSyncEnabled: v })}
              label="Enable Firebase Cloud Sync"
            />
            {user ? (
              <Button
                variant="outline"
                disabled={cloudSyncState === 'syncing' || !settings.cloudSyncEnabled}
                onClick={() =>
                  void syncCloudNow()
                    .then(({ pushed, pulled }) => toast({ tone: 'success', title: 'Cloud Vault Synced', body: `Pushed ${pushed} · Restored ${pulled}` }))
                    .catch((e) => toast({ tone: 'error', title: 'Sync failed', body: e instanceof Error ? e.message : 'Error' }))
                }
              >
                {cloudSyncState === 'syncing' ? <RefreshCw size={15} className="animate-spin" /> : <CheckCircle2 size={15} className="text-emerald-300" />}
                Sync Now
              </Button>
            ) : (
              <Link to="/login"><Button>Login for Cloud Sync</Button></Link>
            )}
          </div>
        </Row>
      </Section>

      {/* Parental Controls & PIN Lock */}
      <Section title="Parental Controls & Category PIN Lock">
        <Row
          label="Enable Parental PIN Lock"
          hint="Locks selected categories, adult (18+/XXX) groups, and pinned items behind your 4–8 digit PIN."
        >
          <Switch
            checked={settings.parentalEnabled}
            onChange={(v) => {
              if (!v && settings.parentalPinHash && !parentalUnlocked) {
                setPinModalOpen(true);
                return;
              }
              updateSettings({ parentalEnabled: v });
            }}
            label="Enable Parental PIN Lock"
          />
        </Row>

        <Row
          label={settings.parentalPinHash ? 'Change Parental PIN' : 'Set 4–8 Digit Parental PIN'}
          hint="PIN is hashed with SHA-256; unlocking lasts 30 minutes or until you tap Lock Now."
        >
          <div className="flex items-center gap-2">
            <Input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={8}
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
              placeholder={settings.parentalPinHash ? 'New PIN…' : 'e.g. 1234'}
              className="w-36 font-mono tracking-widest"
              disabled={Boolean(settings.parentalPinHash && !parentalUnlocked)}
            />
            <Button
              onClick={() => void savePin()}
              disabled={newPin.length < 4 || Boolean(settings.parentalPinHash && !parentalUnlocked)}
            >
              Save PIN
            </Button>
            {settings.parentalPinHash && (
              <Button
                variant="outline"
                onClick={() => (parentalUnlocked ? lockParentalNow() : setPinModalOpen(true))}
              >
                {parentalUnlocked ? <LockOpen size={15} className="text-emerald-300" /> : <Lock size={15} className="text-amber-300" />}
                {parentalUnlocked ? 'Lock Now' : 'Unlock to Edit'}
              </Button>
            )}
          </div>
        </Row>

        <Row
          label="Auto-lock 18+ / Adult / XXX categories"
          hint="Automatically hides & PIN-protects groups matching Adult/XXX/18+/NSFW keywords."
        >
          <Switch
            checked={settings.parentalAutoAdult}
            onChange={(v) => updateSettings({ parentalAutoAdult: v })}
            label="Auto-lock adult categories"
          />
        </Row>

        {allGroups.length > 0 && (
          <details className="rounded-xl border border-border bg-panel p-3">
            <summary className="cursor-pointer text-sm font-bold text-silver">
              Lock Specific Categories ({settings.lockedGroups.length} locked)
            </summary>
            {!parentalUnlocked && settings.parentalPinHash ? (
              <p className="mt-2 flex items-center gap-2 text-xs text-amber-300">
                <ShieldAlert size={14} />Category locks edit karne ke liye pehle upar “Unlock to Edit” dabayein.
              </p>
            ) : (
              <div className="mt-3 flex max-h-52 flex-wrap gap-1.5 overflow-y-auto">
                {allGroups.map((g) => {
                  const isLocked = settings.lockedGroups.includes(g);
                  return (
                    <button
                      key={g}
                      type="button"
                      onClick={() => toggleGroupLock(g)}
                      className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                        isLocked
                          ? 'border-amber-400/60 bg-amber-500/20 text-amber-200'
                          : 'border-border bg-card text-muted hover:text-silver'
                      }`}
                    >
                      {isLocked ? '🔒 ' : ''}{g}
                    </button>
                  );
                })}
              </div>
            )}
          </details>
        )}
      </Section>

      {/* Video Picture Equalizer */}
      <Section title="Video Picture Equalizer">
        <Row label="Picture Mode Preset" hint="Hardware-accelerated GPU colour & contrast tuning inside the player.">
          <Select
            value={settings.videoPreset}
            onChange={(e) => {
              const id = e.target.value as VideoPicturePreset;
              const p = VIDEO_PICTURE_PRESET_LIST.find((x) => x.id === id) ?? VIDEO_PICTURE_PRESET_LIST[0];
              updateSettings({ videoPreset: p.id, videoBrightness: p.brightness, videoContrast: p.contrast, videoSaturation: p.saturation });
            }}
            aria-label="Video picture preset"
          >
            {VIDEO_PICTURE_PRESET_LIST.map((p) => (
              <option key={p.id} value={p.id}>{p.label} — {p.sub}</option>
            ))}
          </Select>
        </Row>
      </Section>

      <Section title="Appearance">
        <Row label="Theme"><Select value={settings.theme} onChange={(e) => updateSettings({ theme: e.target.value as typeof settings.theme })} aria-label="Theme"><option value="dark">Dark</option><option value="light">Light</option><option value="system">System</option></Select></Row>
        <Row label="Accent colour"><Select value={settings.accent} onChange={(e) => updateSettings({ accent: e.target.value as typeof settings.accent })} aria-label="Accent colour"><option value="sky">Electric Blue</option><option value="cyan">Cyan</option><option value="violet">Violet</option><option value="emerald">Emerald</option></Select></Row>
        <Row label="Density"><Select value={settings.density} onChange={(e) => updateSettings({ density: e.target.value as typeof settings.density })} aria-label="Density"><option value="comfortable">Comfortable</option><option value="compact">Compact</option></Select></Row>
        <Row label="Reduced motion" hint="Also honoured from your operating system via CSS."><Switch checked={settings.reducedMotion} onChange={(v) => updateSettings({ reducedMotion: v })} label="Reduced motion" /></Row>
        <Row label="Live TV layout"><Select value={settings.liveLayout} onChange={(e) => updateSettings({ liveLayout: e.target.value as typeof settings.liveLayout })} aria-label="Live TV layout"><option value="list">List</option><option value="grid">Grid</option></Select></Row>
      </Section>

      <Section title="Playback">
        <Row label="Mizanora ads" hint="Mizanora (hamari apni shop) ki offers home aur player par dikhti hain — SIRAVEX ko free rakhne me madad milti hai."><Switch checked={settings.showAds} onChange={(v) => updateSettings({ showAds: v })} label="Mizanora ads" /></Row>
        <Row label="Autoplay" hint="Automatically connects and starts playback when opening a channel or VOD."><Switch checked={settings.autoplay} onChange={(v) => updateSettings({ autoplay: v })} label="Autoplay" /></Row>
        <Row label="Resume playback"><Switch checked={settings.resumePlayback} onChange={(v) => updateSettings({ resumePlayback: v })} label="Resume playback" /></Row>
        <Row label="Default volume"><input type="range" min={0} max={1} step={0.05} value={settings.defaultVolume} onChange={(e) => updateSettings({ defaultVolume: Number(e.target.value) })} aria-label="Default volume" className="w-44 accent-sky-400" /><span className="text-sm text-muted">{Math.round(settings.defaultVolume * 100)}%</span></Row>
        <Row label="Playback speed"><Select value={settings.playbackSpeed} onChange={(e) => updateSettings({ playbackSpeed: Number(e.target.value) })} aria-label="Default playback speed">{[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => <option key={r} value={r}>{r}×</option>)}</Select></Row>
        <Row label="Preferred audio language" hint="Automatically selects matching multi-audio tracks across HLS, DASH and native streams when available."><Select value={settings.audioLanguage} onChange={(e) => updateSettings({ audioLanguage: e.target.value })} aria-label="Preferred audio language"><option value="">No preference (stream default)</option><option value="ur">Urdu</option><option value="hi">Hindi</option><option value="en">English</option><option value="pa">Punjabi</option><option value="ar">Arabic</option><option value="tr">Turkish</option><option value="fa">Persian</option><option value="bn">Bengali</option><option value="ta">Tamil</option><option value="es">Spanish</option><option value="fr">French</option><option value="de">German</option><option value="pt">Portuguese</option><option value="ru">Russian</option></Select></Row>
        <Row label="Preferred subtitle language" hint="Automatically activates matching embedded subtitle tracks when present."><Select value={settings.subtitleLanguage} onChange={(e) => updateSettings({ subtitleLanguage: e.target.value })} aria-label="Preferred subtitle language"><option value="">Off / No preference</option><option value="en">English</option><option value="ur">Urdu</option><option value="hi">Hindi</option><option value="ar">Arabic</option><option value="tr">Turkish</option><option value="es">Spanish</option><option value="fr">French</option></Select></Row>
        <Row label="Subtitle size"><Select value={settings.subtitleSize} onChange={(e) => updateSettings({ subtitleSize: e.target.value as typeof settings.subtitleSize })} aria-label="Subtitle size"><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></Select></Row>
        <Row label="Subtitle colour"><input type="color" value={settings.subtitleColor} onChange={(e) => updateSettings({ subtitleColor: e.target.value })} aria-label="Subtitle colour" className="h-11 w-16 cursor-pointer rounded border border-border bg-panel" /></Row>
      </Section>

      <Section title="Library & Accessibility">
        <Row label="Default home section"><Select value={settings.defaultHome} onChange={(e) => updateSettings({ defaultHome: e.target.value })} aria-label="Default home section"><option value="/">Home</option><option value="/live">Live TV</option><option value="/multiview">Multi-View 4-Screen</option><option value="/movies">Movies</option><option value="/favourites">Favourites</option></Select></Row>
        <Row label="Default playlist"><Select value={playlists.find((p) => p.isDefault)?.id ?? ''} onChange={(e) => { if (e.target.value) void setDefaultPlaylist(e.target.value); }} aria-label="Default playlist"><option value="">No default</option>{playlists.map((p) => <option key={p.id} value={p.id}>{p.name}{p.isDefault ? ' — default' : ''}</option>)}</Select></Row>
        <Row label="Save recent searches"><Switch checked={settings.saveRecentSearches} onChange={(v) => updateSettings({ saveRecentSearches: v })} label="Save recent searches" /></Row>
        <div className="rounded-xl border border-border bg-panel p-4 text-sm leading-6">
          <p className="font-bold">Pro Keyboard &amp; TV Remote Shortcuts</p>
          <ul className="mt-1 list-disc pl-5 text-muted">
            <li><code className="text-cyanx">Ctrl+K / Cmd+K</code> — Global Quick Command &amp; Channel Palette</li>
            <li><code className="text-cyanx">0–9</code> — Direct numeric channel zapping on Live TV</li>
            <li><code className="text-cyanx">L</code> — Last Channel Recall · <code className="text-cyanx">C</code> — Quick channel drawer</li>
            <li><code className="text-cyanx">Space / K</code> — Play/Pause · <code className="text-cyanx">← / →</code> — Seek 10s · <code className="text-cyanx">F</code> — Fullscreen · <code className="text-cyanx">A</code> — Aspect Ratio</li>
            <li><code className="text-cyanx">1–4</code> (in Multi-View) — Instant audio focus switch across 4 live screens</li>
          </ul>
        </div>
      </Section>

      <Section title="Privacy & Storage">
        <p className="text-sm leading-6 text-muted">
          SIRAVEX stores full channel catalogues, EPG and watch progress locally in IndexedDB. When signed in with Cloud Sync enabled, your playlist connection configs are encrypted client-side (PBKDF2 + AES-256-GCM) before saving to your private Firebase Vault. Exports exclude URLs and credentials unless you explicitly export an M3U playlist from Favourites/Live TV.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void clearHistory().then(() => toast({ tone: 'success', title: 'History cleared' }))}>Clear history</Button>
          <Button variant="outline" onClick={exportSettings}>Export settings (no secrets)</Button>
          <Button variant="outline" onClick={() => void clearAllCachesAndReload()}>Clear app cache &amp; reload</Button>
          <Button variant="danger" onClick={() => setConfirmClear(true)}>Clear cached metadata &amp; all local data</Button>
        </div>
      </Section>

      <Section title="Reset">
        <Row label="Reset all settings to defaults"><Button variant="danger" onClick={() => setConfirmReset(true)}>Reset settings…</Button></Row>
      </Section>

      <PinModal open={pinModalOpen} onClose={() => setPinModalOpen(false)} />

      <ConfirmDialog open={confirmReset} title="Reset settings?" body="Appearance, playback and library preferences return to defaults. Playlists, favourites and history are kept." confirmLabel="Reset settings" onCancel={() => setConfirmReset(false)} onConfirm={() => { resetSettings(); setConfirmReset(false); toast({ tone: 'success', title: 'Settings reset' }); }} />
      <ConfirmDialog open={confirmClear} title="Clear all local data?" body="This deletes playlists, imported items, EPG, favourites, progress and diagnostics from this device. Export your settings first if needed." confirmLabel="Clear everything" onCancel={() => setConfirmClear(false)} onConfirm={async () => { await clearLocalData(); setConfirmClear(false); toast({ tone: 'success', title: 'Local data cleared' }); }} />
    </div>
  );
}
