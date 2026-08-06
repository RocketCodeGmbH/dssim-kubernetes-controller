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
import {KubernetesExecutor} from '../KubernetesExecutor.js';

export class NetworkControl {
  static DeploymentName = 'network-control';
  static pullSecretName = 'network-control-pull-secret';

  static async deploy(): Promise<void> {
    console.log('starting network control..');

    if (!process.env.K8S_NETCONTROL_IMAGE)
      throw new Error(
        'Environment Variable K8S_NETCONTROL_IMAGE not set. Cannot deploy Network Control.'
      );

    const pullSecretDeployed = await NetworkControl.deploySecret();
    await KubernetesExecutor.getInstance().deployDeamonSet(
      NetworkControl.DeploymentName,
      {
        selector: {matchLabels: {name: NetworkControl.DeploymentName}},
        template: {
          metadata: {
            labels: {name: NetworkControl.DeploymentName},
          },
          spec: {
            ...(pullSecretDeployed
              ? {imagePullSecrets: [{name: NetworkControl.pullSecretName}]}
              : {}),
            // hostNetwork: shape host-side veths and reach httpd on localhost.
            // hostPID: resolve container PIDs via /proc and nsenter into pod
            // network namespaces — replaces the pre-1.24 docker.sock mount.
            hostNetwork: true,
            hostPID: true,
            containers: [
              {
                image: process.env.K8S_NETCONTROL_IMAGE,
                imagePullPolicy: 'Always',
                name: NetworkControl.DeploymentName,
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
                env: process.env.K8S_NETCONTROL_IFPREFIX
                  ? [
                      {
                        name: 'IFPREFIX',
                        value: process.env.K8S_NETCONTROL_IFPREFIX,
                      },
                    ]
                  : [],
              },
            ],
          },
        },
      }
    );
  }

  /** Deploys the image pull secret iff registry credentials are configured. */
  private static async deploySecret(): Promise<boolean> {
    if (
      !process.env.K8S_NETCONTROL_IMAGE_HOSTNAME ||
      !process.env.K8S_NETCONTROL_IMAGE_PULL_USERNAME ||
      !process.env.K8S_NETCONTROL_IMAGE_PULL_PASSWORD
    ) {
      console.log(
        'No registry credentials for network control image - assuming a public image.'
      );
      return false;
    }
    console.log('Deploying network control pull secret..');
    try {
      await KubernetesExecutor.getInstance().deployDockercfgSecret(
        NetworkControl.pullSecretName,
        {
          [process.env.K8S_NETCONTROL_IMAGE_HOSTNAME]: {
            username: process.env.K8S_NETCONTROL_IMAGE_PULL_USERNAME,
            password: process.env.K8S_NETCONTROL_IMAGE_PULL_PASSWORD,
          },
        }
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      if (e.statusCode === 409) {
        console.log('Network control pull secret already exists.');
      } else {
        throw e;
      }
    }
    return true;
  }
}
