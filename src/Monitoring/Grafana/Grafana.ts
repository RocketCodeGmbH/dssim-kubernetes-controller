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
import { KubernetesExecutor } from '../../KubernetesExecutor.js';

export class Grafana {
  static DEPLOYMENTNAME = 'grafana';
  static PORT = 3000;
  IMAGE = 'grafana/grafana:latest';

  constructor(
    public readonly dashboards: { [key: string]: string },
    private lokiUrl: string,
    private prometheusUrl: string,
    private nodeSelector?: { [key: string]: string },
    private nodeAffinity?: { [key: string]: string }
  ) { }

  dashboardsConfigMapName = 'grafana-dashboards';
  dashboardProvConfigMapName = 'grafana-dashboard-provisioning';
  dataSourceProvConfigMapName = 'grafana-datasource-provisioning';
  defaultDashboardFolder = '/defaultdashboards';

  deploy = async () => {
    await Promise.all([
      KubernetesExecutor.getInstance().deployConfigMap(
        this.dashboardsConfigMapName,
        this.dashboards
      ),
      KubernetesExecutor.getInstance().deployConfigMap(
        this.dataSourceProvConfigMapName,
        {
          'datasources.yaml': `apiVersion: 1
datasources:
  - name: Loki
    type: loki
    access: proxy
    orgId: 1
    uid: loki
    url: ${this.lokiUrl}
    user:
    database:
    basicAuth:
    basicAuthUser:
    withCredentials:
    isDefault:
    version: 2
    editable: false
  - name: Prometheus
    type: prometheus
    access: proxy
    orgId: 1
    uid: prometheus
    url: ${this.prometheusUrl}
    user:
    database:
    basicAuth:
    basicAuthUser:
    withCredentials:
    isDefault:
    version: 2
    editable: false`,
        }
      ),
      KubernetesExecutor.getInstance().deployConfigMap(
        this.dashboardProvConfigMapName,
        {
          'datasources.yaml': `apiVersion: 1
providers:
# <string> an unique provider name. Required
- name: 'a unique provider name'
  # <int> Org id. Default to 1
  orgId: 1
  # <string> name of the dashboard folder.
  folder: ''
  # <string> folder UID. will be automatically generated if not specified
  folderUid: ''
  # <string> provider type. Default to 'file'
  type: file
  # <bool> disable dashboard deletion
  disableDeletion: false
  # <int> how often Grafana will scan for changed dashboards
  updateIntervalSeconds: 10
  # <bool> allow updating provisioned dashboards from the UI
  allowUiUpdates: false
  options:
    # <string, required> path to dashboard files on disk. Required when using the 'file' type
    path: ${this.defaultDashboardFolder}
    # <bool> use folder names from filesystem to create folders in Grafana
    foldersFromFilesStructure: true`,
        }
      ),
    ]);

    await KubernetesExecutor.getInstance().deployApp(
      Grafana.DEPLOYMENTNAME,
      this.deploymentSpec(Grafana.DEPLOYMENTNAME, [], this.nodeSelector, this.nodeAffinity),
      undefined,
      undefined
    );

    await KubernetesExecutor.getInstance().deployService(
      Grafana.DEPLOYMENTNAME,
      Grafana.DEPLOYMENTNAME,
      [{ port: Grafana.PORT, targetPort: Grafana.PORT, name: 'grafanaport' }]
    );

    await KubernetesExecutor.getInstance().deployIngress(
      Grafana.DEPLOYMENTNAME,

      [
        {
          host: Grafana.DEPLOYMENTNAME,
          http: {
            paths: [
              {
                backend: {
                  service: {
                    name: Grafana.DEPLOYMENTNAME,
                    port: { number: Grafana.PORT },
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

  deploymentSpec = (
    deploymentName: string,
    pullSecrets: V1LocalObjectReference[],
    nodeSelector?: { [key: string]: string },
    nodeAffinity?: { [key: string]: string }
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
          affinity: nodeAffinity ? { nodeAffinity: { requiredDuringSchedulingIgnoredDuringExecution: { nodeSelectorTerms: [{ matchExpressions: Object.entries(nodeAffinity).map(([key, value]) => ({ key, operator: 'NotIn', values: [value] })) }] } } } : undefined,
          volumes: [
            {
              configMap: {
                name: this.dataSourceProvConfigMapName,
              },
              name: this.dataSourceProvConfigMapName,
            },
            {
              configMap: {
                name: this.dashboardProvConfigMapName,
              },
              name: this.dashboardProvConfigMapName,
            },
            {
              configMap: {
                name: this.dashboardsConfigMapName,
              },
              name: this.dashboardsConfigMapName,
            },
          ],
          imagePullSecrets: pullSecrets,
          containers: [
            {
              name: deploymentName,
              image: this.IMAGE,
              ports: [{ containerPort: Grafana.PORT, name: 'restendpoint' }],
              volumeMounts: [
                {
                  name: this.dataSourceProvConfigMapName,
                  mountPath: '/etc/grafana/provisioning/datasources',
                },
                {
                  name: this.dashboardProvConfigMapName,
                  mountPath: '/etc/grafana/provisioning/dashboards',
                },
                {
                  name: this.dashboardsConfigMapName,
                  mountPath: this.defaultDashboardFolder,
                },
              ],
            },
          ],
        },
      },
    };
  };
}
