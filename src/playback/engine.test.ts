import { beforeEach, describe, expect, it } from 'vitest';
import { PlaybackEngine, clearHostRouteMemory, prioritizeCandidatesForHost, warmPlaybackEngines } from './engine';
import type { SourceCandidate } from '@/lib/candidates';

describe('Turbo PlaybackEngine host route memory & pre-warm', () => {
  beforeEach(() => {
    clearHostRouteMemory();
  });

  it('preserves default candidate order when no host hint exists', () => {
    const candidates: SourceCandidate[] = [
      { url: 'https://panel.example.com/live/u/p/101.m3u8', format: 'hls', via: 'direct', label: 'HLS Direct' },
      { url: '/api/relay?url=https%3A%2F%2Fpanel.example.com%2Flive%2Fu%2Fp%2F101.m3u8', format: 'hls', via: 'relay', label: 'HLS Relay' },
      { url: '/api/relay?url=https%3A%2F%2Fpanel.example.com%2Flive%2Fu%2Fp%2F101.ts', format: 'mpegts', via: 'relay', label: 'TS Relay' },
    ];
    const out = prioritizeCandidatesForHost('https://panel.example.com/live/u/p/101.m3u8', candidates);
    expect(out.map((c) => `${c.via}:${c.format}`)).toEqual(['direct:hls', 'relay:hls', 'relay:mpegts']);
  });

  it('promotes the proven winning route (e.g. relay:hls) to index 0 for subsequent channels on the same host', () => {
    const video = document.createElement('video');
    const eng = new PlaybackEngine(video) as unknown as {
      primaryUrl: string;
      candidates: SourceCandidate[];
      candIdx: number;
      candOk: boolean;
      markCandidateOk: () => void;
      destroy: () => void;
    };
    eng.primaryUrl = 'https://panel.example.com/live/u/p/101.m3u8';
    eng.candidates = [
      { url: 'https://panel.example.com/live/u/p/101.m3u8', format: 'hls', via: 'direct', label: 'HLS Direct' },
      { url: '/api/relay?url=https%3A%2F%2Fpanel.example.com%2Flive%2Fu%2Fp%2F101.m3u8', format: 'hls', via: 'relay', label: 'HLS Relay' },
    ];
    eng.candIdx = 1; // relay candidate won on channel #101
    eng.candOk = false;
    eng.markCandidateOk();

    // Now user switches to channel #102 on the same panel host!
    const nextChannelCandidates: SourceCandidate[] = [
      { url: 'https://panel.example.com/live/u/p/102.m3u8', format: 'hls', via: 'direct', label: 'HLS Direct' },
      { url: '/api/relay?url=https%3A%2F%2Fpanel.example.com%2Flive%2Fu%2Fp%2F102.m3u8', format: 'hls', via: 'relay', label: 'HLS Relay' },
      { url: '/api/relay?url=https%3A%2F%2Fpanel.example.com%2Flive%2Fu%2Fp%2F102.ts', format: 'mpegts', via: 'relay', label: 'TS Relay' },
    ];
    const prioritized = prioritizeCandidatesForHost('https://panel.example.com/live/u/p/102.m3u8', nextChannelCandidates);
    expect(prioritized[0]).toEqual(nextChannelCandidates[1]);
    expect(prioritized).toHaveLength(3);
    eng.destroy();
  });

  it('warmPlaybackEngines executes safely without throwing', () => {
    expect(() => warmPlaybackEngines()).not.toThrow();
  });
});
