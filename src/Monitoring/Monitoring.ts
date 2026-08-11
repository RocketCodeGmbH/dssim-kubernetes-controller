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
import {Grafana} from './Grafana/Grafana.js';
import {LoggingPipe} from './LoggingPipeline/LoggingPipeline.js';
import {Loki} from './LoggingPipeline/Loki.js';
import {parseJSON} from '../Utils/ParseJson.js';

export class Monitoring {
  constructor(
    public readonly grafanaDashboards: {[key: string]: string},
    private readonly prometheusUrl: string
  ) {}

  lokiName = 'loki';
  lokiPort = 3100;

  public getLokiExternalUrl = (): string => `https://${this.lokiName}`;
  public getLokiInternalUrl = (): string =>
    `http://${this.lokiName}:${this.lokiPort}`;
  public getLokiClusterUrl = (): string =>
    `http://${this.lokiName}.${
      KubernetesExecutor.getInstance().namespace
    }.svc.cluster.local:${this.lokiPort}`;
  public getGrafanaUrl = (): string => `https://${Grafana.DEPLOYMENTNAME}`;

  deploy = async () => {
    const loki = new Loki(
      this.lokiName,
      this.lokiPort,
      parseJSON(process.env.NODE_SELECTOR),
      parseJSON(process.env.NODE_AFFINITY)
    );
    const grafana = new Grafana(
      this.grafanaDashboards,
      this.getLokiInternalUrl(),
      this.prometheusUrl,
      parseJSON(process.env.NODE_SELECTOR),
      parseJSON(process.env.NODE_AFFINITY)
    );
    const pipeline = new LoggingPipe();
    await Promise.all([
      loki.deploy(),
      grafana.deploy(),
      pipeline.deploy(this.getLokiClusterUrl()),
    ]);
  };
}
