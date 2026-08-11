/**
 * Strips the CRI runtime prefix (docker://, containerd://, cri-o://) from a
 * pod containerStatus containerID and returns the full container ID.
 * The full ID is required: docker-tc-kubernetes resolves containers by
 * grepping /proc cgroup paths, which contain the complete 64-hex ID.
 */
export const parseContainerId = (containerID: string): string =>
  containerID.replace(/^[a-z0-9-]+:\/\//, '');
