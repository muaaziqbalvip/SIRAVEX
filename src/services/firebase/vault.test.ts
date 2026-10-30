import { describe, expect, it } from 'vitest';
import {
  MAX_CLOUD_M3U_CHARS,
  decryptSecret,
  deserializeCloudPlaylist,
  encryptSecret,
  serializeCloudPlaylist,
} from './vault';
import type { PlaylistSource } from '@/types/models';

describe('Firebase Cloud Vault encryption & serialization', () => {
  it('encrypts secrets with AES-256-GCM and decrypts with matching uid', async () => {
    const uid = 'user-uid-alpha-12345';
    const raw = 'http://panel.example.com:8080/get.php?username=ali&password=s3cr3t!@#';
    const cipher = await encryptSecret(raw, uid);
    expect(cipher).toBeDefined();
    expect(cipher!.startsWith('enc:v1:')).toBe(true);
    expect(cipher).not.toContain('s3cr3t');
    expect(cipher).not.toContain('panel.example.com');

    const restored = await decryptSecret(cipher, uid);
    expect(restored).toBe(raw);
  });

  it('cannot decrypt another user’s encrypted secret (per-UID key isolation)', async () => {
    const cipher = await encryptSecret('my-xtream-password-999', 'uid-owner-11111111');
    const attemptOtherUser = await decryptSecret(cipher, 'uid-attacker-22222222');
    expect(attemptOtherUser).toBeUndefined();
  });

  it('round-trips an Xtream Codes PlaylistSource cleanly', async () => {
    const uid = 'uid-xtream-pro-777777';
    const src: PlaylistSource = {
      id: 'pl-xtream-1',
      name: 'Home Xtream VIP',
      type: 'xtream',
      server: 'http://vip.example.tv:8080',
      username: 'muaaz_pro',
      password: 'ultraSecretPassword!',
      hasPassword: true,
      enabled: true,
      isDefault: true,
      itemCount: 8420,
      createdAt: 1730000000000,
    };

    const docData = await serializeCloudPlaylist(src, uid);
    expect(docData.encServer).toMatch(/^enc:v1:/);
    expect(docData.encUsername).toMatch(/^enc:v1:/);
    expect(docData.encPassword).toMatch(/^enc:v1:/);
    expect(JSON.stringify(docData)).not.toContain('ultraSecretPassword!');

    const hydrated = await deserializeCloudPlaylist(docData, uid);
    expect(hydrated.id).toBe('pl-xtream-1');
    expect(hydrated.name).toBe('Home Xtream VIP');
    expect(hydrated.type).toBe('xtream');
    expect(hydrated.server).toBe('http://vip.example.tv:8080');
    expect(hydrated.username).toBe('muaaz_pro');
    expect(hydrated.password).toBe('ultraSecretPassword!');
    expect(hydrated.cloudSynced).toBe(true);
    expect(hydrated.itemCount).toBe(8420);
  });

  it('stores compact M3U files encrypted and omits oversized M3U payloads above MAX_CLOUD_M3U_CHARS', async () => {
    const uid = 'uid-m3u-file-999999';
    const smallM3u = '#EXTM3U\n#EXTINF:-1,Geo News\nhttps://example.com/geo.m3u8\n';
    const smallDoc = await serializeCloudPlaylist(
      {
        id: 'pl-file-small',
        name: 'Small File',
        type: 'file',
        rawM3uText: smallM3u,
        enabled: true,
        isDefault: false,
        itemCount: 1,
        createdAt: 100,
      },
      uid,
    );
    expect(smallDoc.encRawM3u).toMatch(/^enc:v1:/);
    const restoredSmall = await deserializeCloudPlaylist(smallDoc, uid);
    expect(restoredSmall.rawM3uText).toBe(smallM3u);

    const hugeDoc = await serializeCloudPlaylist(
      {
        id: 'pl-file-huge',
        name: 'Huge File',
        type: 'file',
        rawM3uText: 'x'.repeat(MAX_CLOUD_M3U_CHARS + 50),
        enabled: true,
        isDefault: false,
        itemCount: 15000,
        createdAt: 200,
      },
      uid,
    );
    expect(hugeDoc.encRawM3u).toBeNull();
  });
});
