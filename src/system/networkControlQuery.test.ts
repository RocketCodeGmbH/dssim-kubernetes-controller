import {describe, it, expect} from 'vitest';
import {buildNetworkControlQuery} from './networkControlQuery.js';

describe('buildNetworkControlQuery', () => {
  it('always leads with the direction', () => {
    expect(buildNetworkControlQuery({}, 'in')).toBe('dir=in');
    expect(buildNetworkControlQuery({}, 'out')).toBe('dir=out');
  });

  it('renders bandwidth as a tc rate', () => {
    expect(
      buildNetworkControlQuery({bandwidth: {value: 56, unit: 'kbit'}}, 'in')
    ).toBe('dir=in&rate=56kbit');
  });

  it('renders all fields joined with &', () => {
    expect(
      buildNetworkControlQuery(
        {
          bandwidth: {value: 1, unit: 'mbit'},
          delay: {value: 10, unit: 'ms'},
          lossRate: 5,
          duplicateRate: 6,
          corruptionRate: 7,
        },
        'out'
      )
    ).toBe('dir=out&rate=1mbit&delay=10ms&loss=5%&duplicate=6%&corrupt=7%');
  });
});
