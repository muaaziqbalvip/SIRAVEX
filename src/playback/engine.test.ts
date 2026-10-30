import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlaybackEngine, clearHostRouteMemory, prioritizeCandidatesForHost, warmPlaybackEngines } from './engine';
import type { SourceCandidate } from '@/lib/candidates';

describe('HyperSpeed PlaybackEngine v6 — host route memory, smart CORS jump & pre-warm', () => {
  beforeEach(() => {
    clearHostRouteMemory();
  });

  it('preserves default candidate order when no host hint exists', () => {
    const candidates: SourceCandidate[] = [
      { url: 'https://panel.example.com/live/u/p/101.m3u8', format: 'hls', via: 'direct', label: 'HLS Direct' },
      { url: '/api/relay?u=https%3A%2F%2Fpanel.example.com%2Flive%2Fu%2Fp%2F101.m3u8', format: 'hls', via: 'relay', label: 'HLS Relay' },
      { url: '/api/relay?u=https%3A%2F%2Fpanel.example.com%2Flive%2Fu%2Fp%2F101.ts', format: 'mpegts', via: 'relay', label: 'TS Relay' },
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
      { url: '/api/relay?u=https%3A%2F%2Fpanel.example.com%2Flive%2Fu%2Fp%2F101.m3u8', format: 'hls', via: 'relay', label: 'HLS Relay' },
    ];
    eng.candIdx = 1;
    eng.candOk = false;
    eng.markCandidateOk();

    const nextChannelCandidates: SourceCandidate[] = [
      { url: 'https://panel.example.com/live/u/p/102.m3u8', format: 'hls', via: 'direct', label: 'HLS Direct' },
      { url: '/api/relay?u=https%3A%2F%2Fpanel.example.com%2Flive%2Fu%2Fp%2F102.m3u8', format: 'hls', via: 'relay', label: 'HLS Relay' },
      { url: '/api/relay?u=https%3A%2F%2Fpanel.example.com%2Flive%2Fu%2Fp%2F102.ts', format: 'mpegts', via: 'relay', label: 'TS Relay' },
    ];
    const prioritized = prioritizeCandidatesForHost('https://panel.example.com/live/u/p/102.m3u8', nextChannelCandidates);
    expect(prioritized[0]).toEqual(nextChannelCandidates[1]);
    expect(prioritized).toHaveLength(3);
    eng.destroy();
  });

  it('jumps straight from a failed direct candidate to the first relay candidate instead of wasting retries on direct', () => {
    const video = document.createElement('video');
    const eng = new PlaybackEngine(video) as unknown as {
      loadSeq: number;
      candidates: SourceCandidate[];
      candIdx: number;
      candOk: boolean;
      startCandidate: (seq: number) => Promise<void>;
      candidateFailed: (info: { category: string; message: string; retryable: boolean }, seq: number, prefer?: string) => void;
      destroy: () => void;
    };
    eng.loadSeq = 1;
    eng.candOk = false;
    eng.candIdx = 0;
    eng.candidates = [
      { url: 'https://panel.example.com/live/u/p/1.m3u8', format: 'hls', via: 'direct', label: 'HLS Direct' },
      { url: 'https://panel.example.com/live/u/p/1.ts', format: 'mpegts', via: 'direct', label: 'TS Direct' },
      { url: '/api/relay?u=https%3A%2F%2Fpanel.example.com%2Flive%2Fu%2Fp%2F1.m3u8', format: 'hls', via: 'relay', label: 'HLS Relay' },
      { url: '/api/relay?u=https%3A%2F%2Fpanel.example.com%2Flive%2Fu%2Fp%2F1.ts', format: 'mpegts', via: 'relay', label: 'TS Relay' },
    ];
    const spy = vi.spyOn(eng, 'startCandidate').mockResolvedValue(undefined);

    // Direct HLS fails (e.g., CORS) -> should jump straight to index 2 (HLS Relay), skipping index 1 (TS Direct)!
    eng.candidateFailed({ category: 'network', message: 'cors', retryable: true }, 1);
    expect(eng.candIdx).toBe(2);
    expect(spy).toHaveBeenCalledTimes(1);

    // Relay HLS gets HTTP 415 (preferFormat = 'mpegts') -> jumps to index 3 (TS Relay) or mpegts!
    eng.candidateFailed({ category: 'network', message: 'not hls', retryable: true }, 1, 'mpegts');
    expect(eng.candidates[eng.candIdx].format).toBe('mpegts');
    eng.destroy();
  });

  it('warmPlaybackEngines executes safely without throwing', () => {
    expect(() => warmPlaybackEngines()).not.toThrow();
  });
});
