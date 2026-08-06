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
import {
  BandwidthUnit,
  ContainerImage,
  CpuUnit,
  Endpoint,
  Instance,
  MemoryUnit,
  TimeUnits,
} from 'dssim-core';
import { KubernetesExecutor } from './KubernetesExecutor.js';
import { NetworkControl } from './system/NetworkControl.js';

export abstract class BaseInstance implements Instance {
  public endPointUrl?: string;
  public hostname?: string;
  public healthCheckUrl: string | undefined;

  constructor(
    public readonly deploymentName: string,
    public readonly containerImages: ContainerImage[],
    public readonly endpoints: Endpoint[],
    public readonly memoryLimit?: { value: number; unit: MemoryUnit },
    public readonly cpuLimit?: { value: number; unit: CpuUnit }
  ) { }

  async deployPullSecrets(): Promise<{ [key: string]: string }> {
    const secrets: { [key: string]: string } = {};
    for (const containerImage of this.containerImages) {
      const secretName = containerImage.image
        .replace(/[^0-9A-Z]+/gi, '')
        .toLowerCase();
      if (containerImage.pullSecret) {
        console.log(`deploy pull secret with name ${secretName}`);
        try {
          await KubernetesExecutor.getInstance().deployDockercfgSecret(
            secretName,
            containerImage.pullSecret
          );
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
          if (e.statusCode === 409) {
            console.log('Pull secret already exists.');
          } else {
            throw e;
          }
        }
        const registry = Object.keys(containerImage.pullSecret)[0];
        secrets[registry] = secretName;
      }
    }
    return secrets;
  }

  public async deploySecrets() { }
  public async deployConfigMaps() { }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async deployApp(pullSecrets: { [key: string]: string }, nodeSelector?: { [key: string]: string }, nodeAffinity?: { [key: string]: string }): Promise<void> { }

  public async deployServices(): Promise<void> {
    await KubernetesExecutor.getInstance().deployService(
      this.deploymentName,
      this.deploymentName,
      this.endpoints.map(e => {
        return {
          name: e.name,
          port: e.port,
          targetPort: e.port,
        };
      })
    );
  }

  public async deployIngress(annotations?: {
    [key: string]: string;
  }): Promise<void> {
    await KubernetesExecutor.getInstance().deployIngress(
      this.deploymentName,
      [
        {
          host: this.deploymentName,
          http: {
            paths: this.endpoints.map(e => {
              return {
                backend: {
                  service: {
                    name: this.deploymentName,
                    port: { number: e.port },
                  },
                },
                path: e.path,
                pathType: 'Prefix',
              };
            }),
          },
        },
      ],
      annotations
    );
  }

  async clearAllNetworkLimitations(): Promise<void> {
    const containerInfo = await this.getContainerInfo();

    await KubernetesExecutor.getInstance().exec(
      containerInfo.podName,
      NetworkControl.DeploymentName,
      ['curl', '-X', 'DELETE', 'localhost:4080/' + containerInfo.containerId]
      //['/usr/bin/curl', '-X', 'LIST', 'localhost:4080']
    );
    return Promise.resolve();
  }

  async setNetworkControl(config: {
    bandwidth?: {
      value: number;
      unit: BandwidthUnit;
    };
    delay?: {
      value: number;
      unit: TimeUnits;
    };
    lossRate?: number;
    duplicateRate?: number;
    corruptionRate?: number;
  }): Promise<void> {
    if (
      !config.bandwidth &&
      !config.delay &&
      !config.lossRate &&
      !config.duplicateRate &&
      !config.corruptionRate
    ) {
      await this.clearAllNetworkLimitations();
    } else {
      const containerInfo = await this.getContainerInfo();

      await KubernetesExecutor.getInstance().exec(
        containerInfo.podName,
        NetworkControl.DeploymentName,
        [
          'curl',
          '-X',
          'POST',
          '-d',
          [
            config.bandwidth
              ? `rate=${config.bandwidth.value}${config.bandwidth.unit}`
              : undefined,
            config.delay
              ? `delay=${config.delay.value}${config.delay.unit}`
              : undefined,
            config.lossRate ? `loss=${config.lossRate}%` : undefined,
            config.duplicateRate
              ? `duplicate=${config.duplicateRate}%`
              : undefined,
            config.corruptionRate
              ? `corrupt=${config.corruptionRate}%`
              : undefined,
          ]
            .filter(e => e) // filter undefined
            .join('&'),
          'localhost:4080/' + containerInfo.containerId,
        ]
        //['/usr/bin/curl', '-X', 'LIST', 'localhost:4080']
      );
    }
    return Promise.resolve();
  }

  public async getContainerInfo(deploymentName1?: string): Promise<{
    podName: string;
    containerId: string;
  }> {
    const nodeInfo =
      await KubernetesExecutor.getInstance().getNodeInfoOfDeployment(
        deploymentName1 ? deploymentName1 as string : this.deploymentName
      );

    console.log(`Found node info for deployment ${deploymentName1 ? deploymentName1 : this.deploymentName}: ${JSON.stringify(nodeInfo)}`);
    const podName =
      await KubernetesExecutor.getInstance().getPodNameOfDeploymentOnNode(
        nodeInfo[0].nodeName,
        NetworkControl.DeploymentName
      );
    return { podName: podName, containerId: nodeInfo[0].containerId };
  }

}
