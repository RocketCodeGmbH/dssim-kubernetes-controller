/*
 * Copyright 2023 Fraunhofer IEE
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Contributors:
 *       Michel Otto - initial implementation
 *
 */
import {V1PodSpec} from '@kubernetes/client-node';

export const NETWORK_CONTROL_NAME = 'network-control';

const MODULES_VOLUME = 'lib-modules';

// sch_netem/sch_tbf ship in a separate package on most distros
// (linux-modules-extra, kernel-modules-extra) that minimal node images omit,
// and the kernel only autoloads them on first use. Loading them up front fixes
// the common case; deliberately best-effort, because a kernel with netem built
// in, or one that forbids module loading, is still perfectly able to shape --
// the agent's preflight is what decides that.
const LOAD_QDISC_MODULES =
  'modprobe -a sch_netem sch_tbf || ' +
  'echo "could not load sch_netem/sch_tbf; the preflight will report whether ' +
  'this kernel provides them"';

export interface NetworkControlPodSpecOptions {
  image: string;
  pullSecretName?: string;
  ifPrefix?: string;
}

export function buildNetworkControlPodSpec(
  options: NetworkControlPodSpecOptions
): V1PodSpec {
  return {
    ...(options.pullSecretName
      ? {imagePullSecrets: [{name: options.pullSecretName}]}
      : {}),
    // hostNetwork: shape host-side veths and reach httpd on localhost.
    // hostPID: resolve container PIDs via /proc and nsenter into pod
    // network namespaces — replaces the pre-1.24 docker.sock mount.
    hostNetwork: true,
    hostPID: true,
    volumes: [
      {
        name: MODULES_VOLUME,
        hostPath: {path: '/lib/modules', type: 'DirectoryOrCreate'},
      },
    ],
    initContainers: [
      {
        name: 'load-qdisc-modules',
        image: options.image,
        imagePullPolicy: 'Always',
        command: ['/bin/sh', '-c', LOAD_QDISC_MODULES],
        securityContext: {
          // SYS_MODULE: modprobe. Narrower than the blanket privileged: true
          // that CNI module loaders usually ask for.
          capabilities: {add: ['SYS_MODULE']},
          privileged: false,
        },
        volumeMounts: [
          {name: MODULES_VOLUME, mountPath: '/lib/modules', readOnly: true},
        ],
      },
    ],
    containers: [
      {
        image: options.image,
        imagePullPolicy: 'Always',
        name: NETWORK_CONTROL_NAME,
        securityContext: {
          allowPrivilegeEscalation: true,
          capabilities: {
            // NET_ADMIN: tc; SYS_ADMIN: setns; SYS_PTRACE: /proc/<pid>/ns
            add: ['NET_ADMIN', 'SYS_ADMIN', 'SYS_PTRACE'],
          },
          privileged: false,
          readOnlyRootFilesystem: false,
        },
        ports: [{name: 'httpd', containerPort: 4080}],
        env: options.ifPrefix
          ? [{name: 'IFPREFIX', value: options.ifPrefix}]
          : [],
      },
    ],
  };
}
