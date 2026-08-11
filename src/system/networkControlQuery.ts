import {NetworkProfile} from 'dssim-core';

export type TrafficDirection = 'in' | 'out';

/**
 * Builds the docker-tc-kubernetes POST body for one direction,
 * e.g. "dir=in&rate=56kbit&delay=10ms".
 */
export const buildNetworkControlQuery = (
  profile: NetworkProfile,
  dir: TrafficDirection
): string =>
  [
    `dir=${dir}`,
    profile.bandwidth
      ? `rate=${profile.bandwidth.value}${profile.bandwidth.unit}`
      : undefined,
    profile.delay
      ? `delay=${profile.delay.value}${profile.delay.unit}`
      : undefined,
    profile.lossRate ? `loss=${profile.lossRate}%` : undefined,
    profile.duplicateRate ? `duplicate=${profile.duplicateRate}%` : undefined,
    profile.corruptionRate ? `corrupt=${profile.corruptionRate}%` : undefined,
  ]
    .filter(e => e)
    .join('&');
