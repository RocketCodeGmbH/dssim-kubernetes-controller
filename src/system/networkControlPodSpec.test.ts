import {describe, it, expect} from 'vitest';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildNetworkControlPodSpec} from './networkControlPodSpec.js';

const IMAGE = 'registry.example/network-control:1.0.0';

/** Runs the loader's command with `modprobe` stubbed, as the node would. */
function runLoaderCommand(modprobeScript: string) {
  const [command, ...args] = buildNetworkControlPodSpec({
    image: IMAGE,
  }).initContainers![0].command!;
  const stubDir = mkdtempSync(join(tmpdir(), 'netcontrol-'));
  writeFileSync(join(stubDir, 'modprobe'), modprobeScript, {mode: 0o755});
  return spawnSync(command, args, {
    encoding: 'utf8',
    env: {...process.env, PATH: `${stubDir}:${process.env.PATH}`},
  });
}

describe('buildNetworkControlPodSpec', () => {
  it('loads both shaping qdisc modules before the agent starts', () => {
    const result = runLoaderCommand('#!/bin/sh\necho "modprobe $*"\n');
    expect(result.stdout).toContain('sch_netem');
    expect(result.stdout).toContain('sch_tbf');
  });

  it('requests the modules as modules, not as parameters of the first', () => {
    // `modprobe sch_netem sch_tbf` passes sch_tbf as a *parameter* to sch_netem;
    // only -a treats every argument as a module name.
    const result = runLoaderCommand('#!/bin/sh\necho "modprobe $*"\n');
    expect(result.stdout).toContain('-a');
  });

  it('does not fail the pod when the modules cannot be loaded', () => {
    // The agent's preflight is the authoritative gate. A node whose kernel has
    // netem built in, or which forbids module loading outright, must still come
    // up rather than crash-loop here.
    expect(runLoaderCommand('#!/bin/sh\nexit 1\n').status).toBe(0);
  });

  it("mounts the node's modules read-only into the loader", () => {
    const spec = buildNetworkControlPodSpec({image: IMAGE});
    const mount = spec.initContainers![0].volumeMounts![0];
    expect(mount.mountPath).toBe('/lib/modules');
    expect(mount.readOnly).toBe(true);
    const volume = spec.volumes!.find(v => v.name === mount.name);
    expect(volume!.hostPath!.path).toBe('/lib/modules');
  });

  it('grants the loader CAP_SYS_MODULE rather than full privilege', () => {
    const loader = buildNetworkControlPodSpec({image: IMAGE})
      .initContainers![0];
    expect(loader.securityContext!.capabilities!.add).toEqual(['SYS_MODULE']);
    expect(loader.securityContext!.privileged).toBe(false);
  });

  it('leaves the agent container unprivileged with its shaping capabilities', () => {
    const agent = buildNetworkControlPodSpec({image: IMAGE}).containers[0];
    expect(agent.securityContext!.capabilities!.add).toEqual([
      'NET_ADMIN',
      'SYS_ADMIN',
      'SYS_PTRACE',
    ]);
    expect(agent.securityContext!.privileged).toBe(false);
  });

  it('runs both containers from the same image', () => {
    const spec = buildNetworkControlPodSpec({image: IMAGE});
    expect(spec.initContainers![0].image).toBe(IMAGE);
    expect(spec.containers[0].image).toBe(IMAGE);
  });

  it('keeps host network and PID access for the agent', () => {
    const spec = buildNetworkControlPodSpec({image: IMAGE});
    expect(spec.hostNetwork).toBe(true);
    expect(spec.hostPID).toBe(true);
  });

  it('passes IFPREFIX to the agent when configured', () => {
    const spec = buildNetworkControlPodSpec({image: IMAGE, ifPrefix: 'cali'});
    expect(spec.containers[0].env).toEqual([{name: 'IFPREFIX', value: 'cali'}]);
  });

  it('sends no env to the agent when IFPREFIX is unset', () => {
    expect(
      buildNetworkControlPodSpec({image: IMAGE}).containers[0].env
    ).toEqual([]);
  });

  it('references the pull secret only when one was deployed', () => {
    expect(
      buildNetworkControlPodSpec({image: IMAGE, pullSecretName: 'ps'})
        .imagePullSecrets
    ).toEqual([{name: 'ps'}]);
    expect(
      buildNetworkControlPodSpec({image: IMAGE}).imagePullSecrets
    ).toBeUndefined();
  });
});
