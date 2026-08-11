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
  V1DeploymentSpec,
  V1LocalObjectReference,
} from '@kubernetes/client-node';
import {KubernetesExecutor} from '../../KubernetesExecutor.js';

export class Loki {
  constructor(
    public deploymentName: string,
    public readonly port: number,
    private nodeSelector?: {[key: string]: string},
    private nodeAffinity?: {[key: string]: string}
  ) {}

  deploy = async () => {
    await KubernetesExecutor.getInstance().deployConfigMap(
      this.CONFIGMAPNAME,
      this.configFile
    );

    await KubernetesExecutor.getInstance().deployApp(
      this.deploymentName,
      this.deploymentSpec(
        this.deploymentName,
        [],
        this.nodeSelector,
        this.nodeAffinity
      ),
      undefined,
      undefined
    );

    await KubernetesExecutor.getInstance().deployService(
      this.deploymentName,
      this.deploymentName,
      [
        {port: this.port, targetPort: this.port, name: 'lokiport'},
        {port: this.GRPCPORT, targetPort: this.GRPCPORT, name: 'grpcport'},
      ]
    );

    await KubernetesExecutor.getInstance().deployIngress(
      this.deploymentName,

      [
        {
          host: this.deploymentName,
          http: {
            paths: [
              {
                backend: {
                  service: {
                    name: this.deploymentName,
                    port: {number: this.port},
                  },
                },
                path: '/',
                pathType: 'Prefix',
              },
            ],
          },
        },
      ]
    );
  };

  IMAGE = 'grafana/loki:latest';

  GRPCPORT = 9096;
  CONFIGMAPNAME = 'lokiconfig';
  configFile: {[key: string]: string} = {
    'local-config.yaml': `auth_enabled: false
  
  server:
    http_listen_port: ${this.port}
    grpc_listen_port: ${this.GRPCPORT}
  
  common:
    path_prefix: /tmp/loki
    storage:
      filesystem:
        chunks_directory: /tmp/loki/chunks
        rules_directory: /tmp/loki/rules
    replication_factor: 1
    ring:
      instance_addr: 127.0.0.1
      kvstore:
        store: inmemory
  
  query_range:
    results_cache:
      cache:
        embedded_cache:
          enabled: true
          max_size_mb: 100
  
  schema_config:
    configs:
      - from: 2020-10-24
        store: boltdb-shipper
        object_store: filesystem
        schema: v11
        index:
          prefix: index_
          period: 24h
  
  ruler:
    alertmanager_url: http://localhost:${this.GRPCPORT}`,
  };

  deploymentSpec = (
    deploymentName: string,
    pullSecrets: V1LocalObjectReference[],
    nodeSelector?: {[key: string]: string},
    nodeAffinity?: {[key: string]: string}
  ): V1DeploymentSpec => {
    return {
      selector: {
        matchLabels: {
          app: deploymentName,
        },
      },
      replicas: 1,
      template: {
        metadata: {
          labels: {
            app: deploymentName,
          },
        },
        spec: {
          nodeSelector: nodeSelector,
          affinity: nodeAffinity
            ? {
                nodeAffinity: {
                  requiredDuringSchedulingIgnoredDuringExecution: {
                    nodeSelectorTerms: [
                      {
                        matchExpressions: Object.entries(nodeAffinity).map(
                          ([key, value]) => ({
                            key,
                            operator: 'NotIn',
                            values: [value],
                          })
                        ),
                      },
                    ],
                  },
                },
              }
            : undefined,
          imagePullSecrets: pullSecrets,
          volumes: [
            {
              configMap: {
                name: this.CONFIGMAPNAME,
              },
              name: 'config',
            },
          ],
          containers: [
            {
              name: deploymentName,
              image: this.IMAGE,
              ports: [{containerPort: this.port, name: 'restendpoint'}],
              readinessProbe: {
                failureThreshold: 20,
                httpGet: {
                  path: '/ready',
                  port: this.port,
                  scheme: 'HTTP',
                },
                initialDelaySeconds: 15,
                periodSeconds: 10,
                successThreshold: 1,
                timeoutSeconds: 1,
              },
              //command: ['-config.file=/config/local-config.yaml'],
              volumeMounts: [
                {
                  name: 'config',
                  mountPath: '/config/',
                },
              ],
            },
          ],
        },
      },
    };
  };
}
