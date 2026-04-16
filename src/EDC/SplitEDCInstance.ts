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
import {ContainerImage, Endpoint} from 'dssim-core';
import {BaseInstance} from '../BaseInstance.js';
import {KubernetesExecutor} from '../KubernetesExecutor.js';

export class SplitEDCInstance extends BaseInstance {
  private readonly cpName: string;
  private readonly dpName: string;
  private readonly cpConfigMapName: string;
  private readonly dpConfigMapName: string;

  private readonly keystoreFileName = 'keystore';
  private readonly configFileName = 'config.properties';
  private readonly vaultFileName = 'dataspaceconnector-vault.properties';

  /** Endpoints hosted on the control plane pod. */
  static readonly CpEndpoints: Endpoint[] = [
    {name: 'health', path: '/api/check', port: 8080},
    {name: 'controller', path: '/api', port: 8181},
    {name: 'ids', path: '/api/v1/ids', port: 8282},
    {name: 'datamanagement', path: '/api/v1/data', port: 8383},
    {name: 'control', path: '/control', port: 8585},
  ];

  /** Endpoints hosted on the data plane pod. */
  static readonly DpEndpoints: Endpoint[] = [
    {name: 'health', path: '/api/check', port: 8080},
    {name: 'dataplane', path: '/dataplane', port: 8484},
    {name: 'control', path: '/control', port: 8585},
    {name: 'public', path: '/public', port: 8686},
  ];

  constructor(
    deploymentName: string,
    public readonly username: string,
    public readonly password: string,
    private readonly generateCpConfig: (
      cpHostname: string,
      cpEndpoints: Endpoint[]
    ) => string,
    private readonly generateDpConfig: (
      dpHostname: string,
      cpHostname: string,
      dpEndpoints: Endpoint[]
    ) => string,
    private readonly keystore: string,
    private readonly vaultFile: string,
    private readonly vaultPw: string,
    cpImage: ContainerImage,
    dpImage: ContainerImage
  ) {
    // Pass CpEndpoints as the canonical endpoint list (used by ScenarioController
    // when wiring up SplitEDCController — must include ids, control, datamanagement).
    // Pass both images so BaseInstance.deployPullSecrets() handles both.
    super(deploymentName, [cpImage, dpImage], SplitEDCInstance.CpEndpoints);
    this.cpName = `${deploymentName}-cp`;
    this.dpName = `${deploymentName}-dp`;
    this.cpConfigMapName = `edc-pre-config-${this.cpName}`;
    this.dpConfigMapName = `edc-pre-config-${this.dpName}`;
  }

  public async deployConfigMaps(): Promise<void> {
    await KubernetesExecutor.getInstance().deployConfigMap(
      this.cpConfigMapName,
      {
        [this.configFileName]: this.generateCpConfig(
          this.cpName,
          SplitEDCInstance.CpEndpoints
        ),
        [this.vaultFileName]: this.vaultFile,
      },
      {[this.keystoreFileName]: this.keystore}
    );
    await KubernetesExecutor.getInstance().deployConfigMap(
      this.dpConfigMapName,
      {
        [this.configFileName]: this.generateDpConfig(
          this.dpName,
          this.cpName,
          SplitEDCInstance.DpEndpoints
        ),
        [this.vaultFileName]: this.vaultFile,
      },
      {[this.keystoreFileName]: this.keystore}
    );
  }

  public async deployApp(pullSecrets: {[key: string]: string}): Promise<void> {
    await KubernetesExecutor.getInstance().deployApp(
      this.cpName,
      this.buildDeploymentSpec(
        this.cpName,
        this.containerImages[0],
        this.cpConfigMapName,
        SplitEDCInstance.CpEndpoints,
        pullSecrets
      ),
      this.memoryLimit,
      this.cpuLimit
    );
    await KubernetesExecutor.getInstance().deployApp(
      this.dpName,
      this.buildDeploymentSpec(
        this.dpName,
        this.containerImages[1],
        this.dpConfigMapName,
        SplitEDCInstance.DpEndpoints,
        pullSecrets
      ),
      this.memoryLimit,
      this.cpuLimit
    );
  }

  public async deployServices(): Promise<void> {
    await KubernetesExecutor.getInstance().deployService(
      this.cpName,
      this.cpName,
      SplitEDCInstance.CpEndpoints.map(e => ({
        name: e.name,
        port: e.port,
        targetPort: e.port,
      }))
    );
    await KubernetesExecutor.getInstance().deployService(
      this.dpName,
      this.dpName,
      SplitEDCInstance.DpEndpoints.map(e => ({
        name: e.name,
        port: e.port,
        targetPort: e.port,
      }))
    );
  }

  async deployIngress(): Promise<void> {
    const annotations = {
      'nginx.ingress.kubernetes.io/ssl-redirect': 'false',
    };

    try {
      await KubernetesExecutor.getInstance().deployIngress(
        `${this.cpName}-admin`,
        [
          {
            host: this.cpName,
            http: {
              paths: SplitEDCInstance.CpEndpoints.map(e => ({
                backend: {
                  service: {name: this.cpName, port: {number: e.port}},
                },
                path: e.path,
                pathType: 'Prefix',
              })),
            },
          },
        ],
        annotations
      );
    } catch (error) {
      console.log(error);
    }

    try {
      await KubernetesExecutor.getInstance().deployIngress(
        `${this.dpName}-admin`,
        [
          {
            host: this.dpName,
            http: {
              paths: SplitEDCInstance.DpEndpoints.map(e => ({
                backend: {
                  service: {name: this.dpName, port: {number: e.port}},
                },
                path: e.path,
                pathType: 'Prefix',
              })),
            },
          },
        ],
        annotations
      );
    } catch (error) {
      console.log(error);
    }

    this.endPointUrl = `http://${this.cpName}`;
    this.hostname = this.cpName;
    this.healthCheckUrl = `https://${this.cpName}/api/check/health`;
  }

  private buildDeploymentSpec(
    name: string,
    image: ContainerImage,
    configMapName: string,
    endpoints: Endpoint[],
    pullSecrets: {[key: string]: string}
  ) {
    return {
      selector: {matchLabels: {app: name}},
      replicas: 1,
      template: {
        metadata: {labels: {app: name}},
        spec: {
          imagePullSecrets:
            image.pullSecret
              ? [
                  {
                    name: pullSecrets[
                      Object.keys(image.pullSecret)[0]
                    ],
                  },
                ]
              : [],
          volumes: [
            {emptyDir: {}, name: 'config-dir'},
            {configMap: {name: configMapName}, name: configMapName},
          ],
          initContainers: [
            {
              name: 'init-myservice',
              image: 'alpine:latest',
              command: [
                'sh',
                '-c',
                'cp /preconfig/* /config/; echo "{"more": "data"}" > /config/dummydata.json',
              ],
              volumeMounts: [
                {name: 'config-dir', mountPath: '/config'},
                {name: configMapName, mountPath: '/preconfig'},
              ],
            },
          ],
          containers: [
            {
              name: name,
              image: image.image,
              imagePullPolicy: 'Always',
              ports: endpoints.map(e => ({
                containerPort: e.port,
                name: e.name,
              })),
              env: [
                {
                  name: 'EDC_FS_CONFIG',
                  value: `/config/${this.configFileName}`,
                },
                {
                  name: 'EDC_VAULT',
                  value: `/config/${this.vaultFileName}`,
                },
                {
                  name: 'EDC_KEYSTORE',
                  value: `/config/${this.keystoreFileName}`,
                },
                {
                  name: 'EDC_KEYSTORE_PASSWORD',
                  value: this.vaultPw,
                },
              ],
              volumeMounts: [
                {name: 'config-dir', mountPath: '/config'},
              ],
            },
          ],
        },
      },
    };
  }
}
