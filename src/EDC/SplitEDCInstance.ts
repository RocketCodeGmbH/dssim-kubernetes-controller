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
import { ContainerImage, Endpoint } from 'dssim-core';
import { BaseInstance } from '../BaseInstance.js';
import { KubernetesExecutor } from '../KubernetesExecutor.js';

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
    { name: 'health', path: '/api', port: 9080 },
    { name: 'management', path: '/api/management', port: 9081 },
    { name: 'control', path: '/api/control', port: 9082 },
    { name: 'protocol', path: '/api/v1/dsp', port: 9083 },
    { name: 'version', path: '/api/version', port: 9085 },
    { name: 'catalog', path: '/api/catalog', port: 9086 },
  ];

  /** Endpoints hosted on the data plane pod. */
  static readonly DpEndpoints: Endpoint[] = [
    { name: 'health', path: '/api', port: 7080 },
    { name: 'control', path: '/api/control', port: 7082 },
    { name: 'public', path: '/api/v2/public', port: 7084 },
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
      { [this.keystoreFileName]: this.keystore }
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
      { [this.keystoreFileName]: this.keystore }
    );
  }

  public async deployApp(pullSecrets: { [key: string]: string }, nodeSelector?: { [key: string]: string }, nodeAffinity?: { [key: string]: string }): Promise<void> {
    await KubernetesExecutor.getInstance().deployApp(
      this.cpName,
      this.buildDeploymentSpec(
        this.cpName,
        this.containerImages[0],
        this.cpConfigMapName,
        SplitEDCInstance.CpEndpoints,
        pullSecrets,
        nodeSelector,
        nodeAffinity
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
        pullSecrets,
        nodeSelector,
        nodeAffinity
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
                  service: { name: this.cpName, port: { number: e.port } },
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
                  service: { name: this.dpName, port: { number: e.port } },
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

    this.hostname = this.cpName;
    if (process.env.INCLUSTER === '1') {
      console.log('Running in cluster, using http for endpoint and health check');
      this.endPointUrl = `http://${this.cpName}:9081`;
      this.healthCheckUrl = `http://${this.cpName}:9080/api/check/health`;
    } else {
      console.log('Running outside cluster, using https for endpoint and health check');
      this.endPointUrl = `https://${this.cpName}`;
      this.healthCheckUrl = `https://${this.cpName}/api/check/health`;
    }
  }

  private buildDeploymentSpec(
    name: string,
    image: ContainerImage,
    configMapName: string,
    endpoints: Endpoint[],
    pullSecrets: { [key: string]: string },
    nodeSelector?: { [key: string]: string },
    nodeAffinity?: { [key: string]: string }
  ) {
    const healthPort = endpoints.find(e => e.name === 'health')?.port;
    if (healthPort === undefined) {
      throw new Error(
        `No 'health' endpoint defined for ${name}; cannot configure EDC health probes`
      );
    }
    console.log(`{nodeSelector: ${JSON.stringify(nodeSelector)}, nodeAffinity: ${JSON.stringify(nodeAffinity)}}`);
    return {
      selector: { matchLabels: { app: name } },
      replicas: 1,
      template: {
        metadata: { labels: { app: name } },
        spec: {
          nodeSelector: nodeSelector ? nodeSelector : undefined,
          affinity: {
            nodeAffinity: nodeAffinity ? {
              requiredDuringSchedulingIgnoredDuringExecution: {
                nodeSelectorTerms: [
                  {
                    matchExpressions: Object.entries(nodeAffinity || {}).map(
                      ([key, value]) => ({
                        key,
                        operator: 'In',
                        values: [value],
                      })
                    ),
                  },
                ],
              },
            } : undefined,
          },
          imagePullSecrets: image.pullSecret
            ? [
              {
                name: pullSecrets[Object.keys(image.pullSecret)[0]],
              },
            ]
            : [],
          volumes: [
            { emptyDir: {}, name: 'config-dir' },
            { configMap: { name: configMapName }, name: configMapName },
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
                { name: 'config-dir', mountPath: '/config' },
                { name: configMapName, mountPath: '/preconfig' },
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

              readinessProbe: {
                httpGet: { path: '/api/check/readiness', port: healthPort },
                initialDelaySeconds: 10,
                periodSeconds: 5,
                failureThreshold: 12,
              },

              livenessProbe: {
                httpGet: { path: '/api/check/liveness', port: healthPort },
                initialDelaySeconds: 90,
                periodSeconds: 10,
                failureThreshold: 3,
              },
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
              volumeMounts: [{ name: 'config-dir', mountPath: '/config' }],
            },
          ],
        },
      },
    };
  }
}
