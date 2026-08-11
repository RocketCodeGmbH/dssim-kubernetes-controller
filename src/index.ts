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
  ContainerImage,
  EnvironmentControllerInterface,
  Instance,
  ReadinessProbe,
  LogLevel,
  DssimLogger,
  Endpoint,
} from 'dssim-core';
import {BaseInstance} from './BaseInstance.js';
import {CustomService} from './CustomService.js';

import {KubernetesExecutor} from './KubernetesExecutor.js';
import {NetworkControl} from './system/NetworkControl.js';

export {DSCInstance} from './IDS/DSCInstance.js';
export {BrokerInstance} from './IDS/BrokerInstance.js';
export {EDCInstance} from './EDC/EDCInstance.js';
export {DapsInstance} from './IDS/DapsInstance.js';

import {Monitoring} from './Monitoring/Monitoring.js';

export class KubernetesController implements EnvironmentControllerInterface {
  // Private constructor to force the use of factory method and allow async construction
  private constructor(private logger: DssimLogger) {}

  // set up and prepare environment
  // eg. deploy network control deamons
  // TODO? Might deploy Loki instances too
  static async createInstance(
    networkControl: boolean,
    loggingPipeline:
      | {
          dashboardDefinitions: {[key: string]: string};
          prometheusUrl: string;
          defaultLogLevel: LogLevel;
        }
      | undefined
  ): Promise<KubernetesController> {
    const logger = DssimLogger.getInstance();
    let monitoring: Monitoring | undefined;
    if (loggingPipeline) {
      monitoring = new Monitoring(
        loggingPipeline.dashboardDefinitions,
        loggingPipeline.prometheusUrl
      );
      await monitoring.deploy();
      logger.addLokiOutput(monitoring.getLokiExternalUrl());
    }

    if (networkControl) await NetworkControl.deploy();

    const controller = new KubernetesController(logger);
    if (monitoring) {
      controller.logger.log(
        'info',
        `Kubernetes Environent set up successfully. Monitoring has been set up. You can access Grafana Dashboard here: ${monitoring.getGrafanaUrl()} if you have forwarded the hostname to the cluster ip.`,
        KubernetesController.name,
        {}
      );
    }
    {
      controller.logger.log(
        'info',
        'Kubernetes Environent set up successfully. No Monitoring activated.',
        KubernetesController.name,
        {}
      );
    }
    return controller;
  }

  async deployInstance<T extends Instance>(instance: T): Promise<T> {
    if (this.isKubernetesControllerInstance(instance)) {
      // run template
      await this.deployWithTemplate<T>(instance);
      return instance;
    } else {
      throw new Error(
        'Only Instances that implement BaseInstance of the KubernetesController Package can be deployed by this controller'
      );
    }
  }

  private async deployWithTemplate<T extends Instance>(
    instance: T & BaseInstance
  ) {
    const pullSecrets = await instance.deployPullSecrets();
    await instance.deploySecrets();
    await instance.deployConfigMaps();
    await instance.deployApp(pullSecrets);
    await instance.deployServices();
    await instance.deployIngress();
  }

  async deployContainerizedService(
    name: string,
    image: ContainerImage,
    endpoints: Endpoint[],
    readinessProbe?: ReadinessProbe
  ): Promise<Instance> {
    const service = new CustomService(
      name,
      [image],
      endpoints,
      readinessProbe ? [readinessProbe] : undefined
    );
    await this.deployWithTemplate(service);
    service.hostname = name;
    return service;
  }

  async tearDown(): Promise<void> {
    await KubernetesExecutor.getInstance().tearDown();
  }

  private isKubernetesControllerInstance(
    instance: Instance
  ): instance is BaseInstance {
    return (
      (instance as BaseInstance).deployPullSecrets !== undefined &&
      (instance as BaseInstance).deploySecrets !== undefined &&
      (instance as BaseInstance).deployConfigMaps !== undefined &&
      (instance as BaseInstance).deployApp !== undefined &&
      (instance as BaseInstance).deployServices !== undefined &&
      (instance as BaseInstance).deployIngress !== undefined &&
      (instance as BaseInstance).containerImages !== undefined
    );
  }
}

export default KubernetesController;
