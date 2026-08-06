import {describe, it, expect} from 'vitest';
import {parseContainerId} from './containerId.js';

describe('parseContainerId', () => {
  it('strips the containerd prefix and keeps the full 64-char id', () => {
    const id = 'a'.repeat(64);
    expect(parseContainerId(`containerd://${id}`)).toBe(id);
  });

  it('strips docker and cri-o prefixes', () => {
    expect(parseContainerId('docker://abc123')).toBe('abc123');
    expect(parseContainerId('cri-o://abc123')).toBe('abc123');
  });

  it('returns an unprefixed id unchanged', () => {
    expect(parseContainerId('abc123')).toBe('abc123');
  });
});
