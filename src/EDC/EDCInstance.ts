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
import {Instance, ContainerImage, Endpoint} from 'dssim-core';
import {BaseInstance} from '../BaseInstance.js';
import {KubernetesExecutor} from '../KubernetesExecutor.js';

export class EDCInstance extends BaseInstance implements Instance {
  private configMapName: string;
  private keystoreFileName = 'keystore';

  static HealthEndpoint = {name: 'health', path: '/api/check', port: 8080};
  static ControllerEndpoint = {name: 'controller', path: '/api', port: 8181};
  static IDSEndpoint = {name: 'ids', path: '/api/v1/ids', port: 8282};
  static DatamanagementEndpoint = {
    name: 'datamanagement',
    path: '/api/v1/data',
    port: 8383,
  };
  static PublicEndpoint = {name: 'public', path: '/public', port: 8686};
  static DataplaneEndpoint = {
    name: 'dataplane',
    path: '/dataplane',
    port: 8484,
  };
  static ControlEndpoint = {name: 'control', path: '/control', port: 8585};
  static endpoints: Endpoint[] = [
    EDCInstance.HealthEndpoint,
    EDCInstance.ControllerEndpoint,
    EDCInstance.IDSEndpoint,
    EDCInstance.DatamanagementEndpoint,
    EDCInstance.DataplaneEndpoint,
    EDCInstance.ControlEndpoint,
    EDCInstance.PublicEndpoint,
  ];

  private configFileName = 'config.properties';
  private vaultFileName = 'dataspaceconnector-vault.properties';

  constructor(
    public deploymentName: string,
    public readonly username: string,
    public readonly password: string,
    private readonly generateConfigFile: (
      hostname: string,
      endpoints: Endpoint[]
    ) => string,
    private keystore: string,
    private vaultFile: string,
    private vaultPw: string,
    connectorImages: ContainerImage[] = [
      {
        image:
          'registry.gitlab.cc-asp.fraunhofer.de/dssim/dssim-kubernetes-controller/edc-ids-custom:latest',
      },
    ]
  ) {
    super(deploymentName, connectorImages, EDCInstance.endpoints);
    this.configMapName = 'edc-pre-config-' + deploymentName;
  }

  public async deployConfigMaps() {
    await KubernetesExecutor.getInstance().deployConfigMap(
      this.configMapName,
      {
        [this.configFileName]: this.generateConfigFile(
          this.deploymentName,
          this.endpoints
        ),
        [this.vaultFileName]: this.vaultFile,
      },
      {[this.keystoreFileName]: this.keystore}
    );
  }

  public async deployApp(pullSecrets: {[key: string]: string}): Promise<void> {
    await KubernetesExecutor.getInstance().deployApp(
      this.deploymentName,
      {
        selector: {
          matchLabels: {
            app: this.deploymentName,
          },
        },
        replicas: 1,
        template: {
          metadata: {
            labels: {
              app: this.deploymentName,
            },
          },
          spec: {
            imagePullSecrets: pullSecrets
              ? [
                  {
                    name: pullSecrets[
                      Object.keys(this.containerImages[0].pullSecret!)[0]
                    ],
                  },
                ]
              : [],
            volumes: [
              {emptyDir: {}, name: 'config-dir'},
              {
                configMap: {
                  name: this.configMapName,
                },
                name: this.configMapName,
              },
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
                  {
                    name: 'config-dir',
                    mountPath: '/config',
                  },
                  {
                    name: this.configMapName,
                    mountPath: '/preconfig',
                  },
                ],
              },
            ],
            containers: [
              {
                name: this.deploymentName,
                image: this.containerImages[0].image,
                imagePullPolicy: 'Always',
                ports: this.endpoints.map(e => {
                  return {containerPort: e.port, name: e.name};
                }),

                /*readinessProbe: {
                failureThreshold: 20,
                httpGet: {
                  path: '/api/v1/ids',
                  port: 8282,
                  scheme: 'HTTP',
                },
                initialDelaySeconds: 15,
                periodSeconds: 10,
                successThreshold: 1,
                timeoutSeconds: 1,
              },*/
                env: [
                  {
                    name: 'EDC_FS_CONFIG',
                    value: '/config/' + this.configFileName,
                  },
                  {
                    name: 'EDC_VAULT',
                    value: '/config/' + this.vaultFileName,
                  },
                  {
                    name: 'EDC_KEYSTORE',
                    value: '/config/' + this.keystoreFileName,
                  },
                  {
                    name: 'EDC_KEYSTORE_PASSWORD',
                    value: this.vaultPw,
                  },
                ],
                volumeMounts: [
                  {
                    name: 'config-dir',
                    mountPath: '/config',
                  },
                ],
              },
            ],
          },
        },
      },
      this.memoryLimit,
      this.cpuLimit
    );
  }

  async deployIngress(): Promise<void> {
    try {
      await KubernetesExecutor.getInstance().deployIngress(
        this.deploymentName + '-admin',
        [
          {
            host: this.deploymentName,
            http: {
              paths: this.endpoints.map(e => {
                return {
                  backend: {
                    service: {
                      name: this.deploymentName,
                      port: {number: e.port},
                    },
                  },
                  path: e.path,
                  pathType: 'Prefix',
                };
              }),
            },
          },
        ],
        {
          //'nginx.ingress.kubernetes.io/backend-protocol': 'HTTPS',
          'nginx.ingress.kubernetes.io/ssl-redirect': 'false',
        }
      );
    } catch (error) {
      console.log(error);
    }

    this.endPointUrl = `http://${this.deploymentName}`;
    this.hostname = this.deploymentName;
    this.healthCheckUrl = `https://${this.deploymentName}/api/check/health`;
  }
}
