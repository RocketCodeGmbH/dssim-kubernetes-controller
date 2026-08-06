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
import { KubernetesExecutor } from '../KubernetesExecutor.js';

export class NetworkControl {
  static DeploymentName = 'network-control';
  static pullSecretName = 'network-control-pull-secret';

  static async deploy(): Promise<void> {
    console.log('starting network control..');

    if (!process.env.K8S_NETCONTROL_IFPREFIX)
      throw new Error(
        'Environment Variable K8S_NETCONTROL_IFPREFIX not set for network control. Cannot deploy Network Control.'
      );

    await NetworkControl.deploySecret();
    await KubernetesExecutor.getInstance().deployDeamonSet(
      NetworkControl.DeploymentName,
      {
        selector: { matchLabels: { name: NetworkControl.DeploymentName } },
        template: {
          metadata: {
            labels: { name: NetworkControl.DeploymentName },
          },
          spec: {
            imagePullSecrets: [{ name: NetworkControl.pullSecretName }],
            hostNetwork: true,
            volumes: [
              {
                hostPath: {
                  path: '/var/run/docker.sock',
                  type: '',
                },
                name: 'dockersocket',
              },
              /*
              Verzeichnis für container locks - in Kubernetes Umgebung mE so nicht sinnvoll
              {
                hostPath: {
                  path: '/var/docker-tc',
                  type: '',
                },
                name: 'docker-tc',
              },*/
            ],
            containers: [
              {
                image: process.env.K8S_NETCONTROL_IMAGE,
                imagePullPolicy: 'Always',
                name: NetworkControl.DeploymentName,
                securityContext: {
                  allowPrivilegeEscalation: true,
                  capabilities: {
                    add: ['NET_ADMIN'],
                  },
                  privileged: false,
                  readOnlyRootFilesystem: false,
                },
                ports: [{ name: 'httpd', containerPort: 4080 }],
                volumeMounts: [
                  {
                    mountPath: '/var/run/docker.sock',
                    name: 'dockersocket',
                  } /*
                  {
                    mountPath: '/var/docker-tc',
                    name: 'docker-tc',
                  },*/,
                ],
                env: [
                  {
                    name: 'IFPREFIX',
                    value: process.env.K8S_NETCONTROL_IFPREFIX,
                  },
                ],
              },
            ],
          },
        },
      }
    );
  }

  private static async deploySecret() {
    console.log('Deploying network control pull secret..');
    if (
      !process.env.K8S_NETCONTROL_IMAGE
      //  || !process.env.K8S_NETCONTROL_IMAGE_HOSTNAME ||
      // !process.env.K8S_NETCONTROL_IMAGE_PULL_USERNAME ||
      // !process.env.K8S_NETCONTROL_IMAGE_PULL_PASSWORD
    )
      throw new Error('Environment Variable not set for network control.');
    // await KubernetesExecutor.getInstance().deployDockercfgSecret(
    //   NetworkControl.pullSecretName,
    //   {
    //     [process.env.K8S_NETCONTROL_IMAGE_HOSTNAME!]: {
    //       username: process.env.K8S_NETCONTROL_IMAGE_PULL_USERNAME,
    //       password: process.env.K8S_NETCONTROL_IMAGE_PULL_PASSWORD,
    //     },
    //   }
    // );
  }
}
