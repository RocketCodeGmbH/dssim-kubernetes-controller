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
import {
  buildNetworkControlPodSpec,
  NETWORK_CONTROL_NAME,
} from './networkControlPodSpec.js';

export class NetworkControl {
  static DeploymentName = NETWORK_CONTROL_NAME;
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
          spec: buildNetworkControlPodSpec({
            image: process.env.K8S_NETCONTROL_IMAGE,
            pullSecretName: pullSecretDeployed
              ? NetworkControl.pullSecretName
              : undefined,
            ifPrefix: process.env.K8S_NETCONTROL_IFPREFIX,
          }),
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
