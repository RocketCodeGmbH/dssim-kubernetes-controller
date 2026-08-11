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
  Exec,
  AppsV1Api,
  CoreV1Api,
  KubeConfig,
  NetworkingV1Api,
  V1ConfigMap,
  V1Deployment,
  V1DeploymentSpec,
  V1Ingress,
  V1IngressRule,
  V1ObjectMeta,
  V1Service,
  V1ServicePort,
  V1Status,
  V1ResourceRequirements,
  V1DaemonSetSpec,
  CustomObjectsApi,
} from '@kubernetes/client-node';
import {CpuUnit, MemoryUnit, waitFor, b64encode} from 'dssim-core';
import {IncomingMessage} from 'http';
import stream from 'stream';

export class KubernetesExecutor {
  private static instance: KubernetesExecutor;

  private constructor(
    public readonly namespace: string,
    public groupLabel: string,
    private kubeConfig: KubeConfig
  ) {}

  public static getInstance(): KubernetesExecutor {
    if (!KubernetesExecutor.instance) {
      const kubeConfig = new KubeConfig();

      if (!process.env.K8S_KUBECONFIG_PATH)
        throw new Error('K8S_KUBECONFIG_PATH Environment Variable not set.');
      kubeConfig.loadFromFile(process.env.K8S_KUBECONFIG_PATH!);

      if (!process.env.K8S_NAMESPACE)
        throw new Error('K8S_NAMESPACE Environment Variable not set.');
      const namespace = process.env.K8S_NAMESPACE;

      if (!process.env.K8S_GROUPLABEL)
        throw new Error('K8S_GROUPLABEL Environment Variable not set.');
      const groupLabel = process.env.K8S_GROUPLABEL;

      KubernetesExecutor.instance = new KubernetesExecutor(
        namespace,
        groupLabel,
        kubeConfig
      );
    }

    return KubernetesExecutor.instance;
  }

  public async deployApp(
    deploymentName: string,
    deploymentSpec: V1DeploymentSpec,
    memoryLimit: {value: number; unit: MemoryUnit} | undefined,
    cpuLimit: {value: number; unit: CpuUnit} | undefined
  ): Promise<{
    response: IncomingMessage;
    body: V1Deployment;
  }> {
    const modifiedCeploymentSpec: V1DeploymentSpec = {...deploymentSpec};
    modifiedCeploymentSpec.template.metadata!.labels!.group = this.groupLabel;
    modifiedCeploymentSpec.template.spec!.containers =
      modifiedCeploymentSpec.template.spec!.containers.map(c => {
        c.resources = this.buildRessourceManagement(memoryLimit, cpuLimit);
        return c;
      });

    const appDeployment: V1Deployment = {
      metadata: {
        name: deploymentName,
        namespace: this.namespace,
        labels: {
          app: deploymentName,
          group: this.groupLabel,
        },
      },
      spec: deploymentSpec,
    };

    const appApi = this.kubeConfig.makeApiClient(AppsV1Api);
    let result;
    try {
      result = await appApi.createNamespacedDeployment(
        this.namespace,
        appDeployment
      );

      console.log('Successfully spawned: ' + appDeployment.metadata?.name);
      //console.log(deploymentResponse.body);
    } catch (error) {
      console.error(error);
      console.warn(appApi);
      throw new Error('Starting connector failed! Check logs..');
    }

    console.log(
      'Waiting to finish startup of: ' + appDeployment.metadata?.name
    );
    await waitFor(async () => {
      try {
        const status = await appApi.readNamespacedDeploymentStatus(
          deploymentName,
          this.namespace
        );
        //console.log(status.body.status);
        return (
          status.body.status?.readyReplicas &&
          status.body.status.readyReplicas > 0
        );
      } catch (error) {
        console.warn(
          'An error occurred while waiting for deployment. Ignore and keep on trying..'
        );
        console.error(error);
        console.warn(appApi);
        //throw new Error('Starting connector failed! Check logs..');
        return false;
      }
    });

    return result;
  }

  private buildRessourceManagement(
    memoryLimit: {value: number; unit: MemoryUnit} | undefined,
    cpuLimit: {value: number; unit: CpuUnit} | undefined
  ): V1ResourceRequirements | undefined {
    const resourceDefinitions: V1ResourceRequirements = {limits: {}};

    if (memoryLimit && memoryLimit.value) {
      resourceDefinitions.limits!['memory'] =
        memoryLimit.value + memoryLimit.unit;
    }
    if (cpuLimit && cpuLimit.value) {
      resourceDefinitions.limits!['cpu'] =
        cpuLimit.value + (cpuLimit.unit === 'milicpu' ? 'm' : '');
    }
    console.log('Deploying with the following resource definitions:');
    console.log(resourceDefinitions);
    return resourceDefinitions;
  }

  public async deployDockercfgSecret(
    name: string,
    secret: {
      [registrydomain: string]: {
        username: string;
        password: string;
      };
    }
  ): Promise<void> {
    const coreApi = this.kubeConfig.makeApiClient(CoreV1Api);
    const secretData = b64encode(
      JSON.stringify({
        auths: secret,
      })
    );
    await coreApi.createNamespacedSecret(this.namespace, {
      metadata: {
        name: name,
        labels: {
          group: this.groupLabel,
        },
      },
      type: 'kubernetes.io/dockerconfigjson',
      data: {
        '.dockerconfigjson': secretData,
      },
    });
  }

  public async deployOpaqueSecret(
    name: string,
    secrets: {
      [key: string]: string;
    }
  ): Promise<void> {
    const coreApi = this.kubeConfig.makeApiClient(CoreV1Api);
    await coreApi.createNamespacedSecret(this.namespace, {
      metadata: {
        name: name,
        labels: {
          group: this.groupLabel,
        },
      },
      type: 'Opaque',
      data: secrets,
    });
  }

  public async deployIngress(
    ingressName: string,
    rules: Array<V1IngressRule>,
    annotations?: {[key: string]: string}
  ): Promise<{
    response: IncomingMessage;
    body: V1Ingress;
  }> {
    const serviceApi = this.kubeConfig.makeApiClient(NetworkingV1Api);
    const result = await serviceApi.createNamespacedIngress(this.namespace, {
      apiVersion: 'networking.k8s.io/v1',
      kind: 'Ingress',
      metadata: {
        name: ingressName,
        annotations: annotations,
        labels: {
          group: this.groupLabel,
        },
      },
      spec: {
        rules: rules,
        tls: [{hosts: rules.map(rule => rule.host ?? '')}],
      },
    });
    console.log('Configured Ingress: ' + ingressName);
    return result;
  }

  public async getDeployment(deploymentName: string): Promise<V1Deployment> {
    const appApi = this.kubeConfig.makeApiClient(AppsV1Api);
    const result = await appApi.readNamespacedDeployment(
      deploymentName,
      this.namespace
    );
    return result.body;
  }

  public async getDeploymentStatus(
    deploymentName: string
  ): Promise<V1Deployment> {
    const appApi = this.kubeConfig.makeApiClient(AppsV1Api);
    const result = await appApi.readNamespacedDeploymentStatus(
      deploymentName,
      this.namespace
    );
    return result.body;
  }

  public async patchDeployment(
    deploymentName: string,
    deployment: V1Deployment
  ): Promise<V1Deployment> {
    const appApi = this.kubeConfig.makeApiClient(AppsV1Api);
    const result = await appApi.patchNamespacedDeployment(
      deploymentName,
      this.namespace,
      deployment
    );
    return result.body;
  }

  public async deployService(
    serviceName: string,
    appName: string,
    targetPorts: V1ServicePort[]
  ): Promise<{
    response: IncomingMessage;
    body: V1Service;
  }> {
    console.log(`starting to deploy service ${serviceName}.`);
    const serviceBody: V1Service = {
      kind: 'Service',
      metadata: {
        name: serviceName,
        labels: {
          group: this.groupLabel,
        },
      },
      spec: {
        selector: {
          app: appName,
        },
        ports: targetPorts,
      },
    };

    try {
      const coreApi = this.kubeConfig.makeApiClient(CoreV1Api);
      const result = await coreApi.createNamespacedService(
        this.namespace,
        serviceBody
      );
      console.log('Configured Service: ' + serviceName);
      return result;
    } catch (error) {
      console.log('Oops, something went wrong!');
      console.error(error);
      throw new Error('Starting connector failed! Check logs..');
    }
  }

  public async deployDeamonSet(name: string, spec: V1DaemonSetSpec) {
    const appApi = this.kubeConfig.makeApiClient(AppsV1Api);
    try {
      const result = await appApi.createNamespacedDaemonSet(this.namespace, {
        kind: 'DaemonSet',
        metadata: {
          name: name,
          labels: {
            group: this.groupLabel,
          },
        },
        spec: spec,
      });
      console.log(result);

      await this.waitForAllDaemonSetsReady;
    } catch (error) {
      console.error(error);
    }
  }

  private async waitForAllDaemonSetsReady(name: string): Promise<void> {
    const appApi = this.kubeConfig.makeApiClient(AppsV1Api);
    console.log(`Waiting deamonset ${name} to come up..`);
    await waitFor(async () => {
      const status = await appApi.readNamespacedDaemonSetStatus(
        name,
        this.namespace
      );
      //console.log(status.body.status);
      return (
        status.body.status?.numberReady &&
        status.body.status.numberReady ===
          status.body.status.desiredNumberScheduled
      );
    });
  }

  public async deployConfigMap(
    name: string,
    data?: {[key: string]: string},
    binaryData?: {[key: string]: string}
  ): Promise<{
    response: IncomingMessage;
    body: V1ConfigMap;
  }> {
    try {
      const coreApi = this.kubeConfig.makeApiClient(CoreV1Api);
      return await coreApi.createNamespacedConfigMap(this.namespace, {
        apiVersion: 'v1',
        data: data,
        binaryData: binaryData,
        kind: 'ConfigMap',
        metadata: {
          name: name,
          labels: {
            group: this.groupLabel,
          },
        },
      });
    } catch (error) {
      console.log('Oops, something went wrong!');
      console.error(error);
      throw new Error('Deploying config map failed! Check logs..');
    }
  }

  public getNodeInfoOfDeployment = async (
    deploymentName: string
  ): Promise<{nodeName: string; containerId: string}[]> => {
    console.log(`trying to find network control for ${deploymentName}`);
    const coreApi = this.kubeConfig.makeApiClient(CoreV1Api);
    const info = await coreApi.listNamespacedPod(
      this.namespace,
      undefined,
      undefined,
      undefined,
      undefined,
      'app=' + deploymentName
    );

    return info.body.items.map(e => {
      if (
        e.spec?.nodeName &&
        e.status?.containerStatuses &&
        e.status?.containerStatuses![0].containerID
      ) {
        return {
          nodeName: e.spec!.nodeName!,
          containerId: e.status!.containerStatuses![0].containerID!.substring(
            9,
            21
          ),
        };
      } else {
        console.error(e.spec);
        throw new Error('Node name or container id not found ');
      }
    });
  };

  public getPodNameOfDeploymentOnNode = async (
    nodeName: string,
    appName: string
  ): Promise<string> => {
    console.log('Getting Pod running on ' + nodeName);
    const coreApi = this.kubeConfig.makeApiClient(CoreV1Api);
    const node = await coreApi.listNamespacedPod(
      this.namespace,
      undefined,
      undefined,
      undefined,
      `spec.nodeName=${nodeName}`
    );
    const result = node.body.items.find(
      e => e.metadata?.labels?.name === appName
    );
    //console.log(result);
    if (!result?.metadata?.name) {
      console.error(node.body);
      throw Error(
        `App not found on Node. Was looking for ${appName} on ${nodeName}.`
      );
    } else {
      console.log(`pod name ${result!.metadata!.name}`);
      return result!.metadata!.name;
    }
  };

  public exec = async (
    podName: string,
    containerName: string,
    command: string | string[]
  ): Promise<void> => {
    console.log(`executing '${command}' on ${podName}`);
    const exec = new Exec(this.kubeConfig);
    const r = await new Promise((resolve, reject) => {
      try {
        exec.exec(
          this.namespace,
          podName,
          containerName,
          command,
          process.stdout as stream.Writable,
          process.stderr as stream.Writable,
          process.stdin as stream.Readable,
          true,
          (status: V1Status) => {
            // tslint:disable-next-line:no-console
            console.log('Exited with status:');
            // tslint:disable-next-line:no-console
            console.log(JSON.stringify(status, null, 2));
            resolve(status);
          }
        );
      } catch (error) {
        console.error(error);
        reject(error);
      }
    });
    console.log(r);
    return Promise.resolve();
  };

  public tearDown = async () => {
    console.log('starting teardown..');
    const appApi = this.kubeConfig.makeApiClient(AppsV1Api);
    await this.deleteAll(
      await appApi.listNamespacedDeployment(this.namespace),
      element => {
        return appApi.deleteNamespacedDeployment(element, this.namespace);
      }
    );

    await this.deleteAll(
      await appApi.listNamespacedDaemonSet(this.namespace),
      element => {
        return appApi.deleteNamespacedDaemonSet(element, this.namespace);
      }
    );

    const serviceApi = this.kubeConfig.makeApiClient(NetworkingV1Api);
    await this.deleteAll(
      await serviceApi.listNamespacedIngress(this.namespace),
      element => {
        return serviceApi.deleteNamespacedIngress(element, this.namespace);
      }
    );

    const coreApi = this.kubeConfig.makeApiClient(CoreV1Api);
    await this.deleteAll(
      await coreApi.listNamespacedService(this.namespace),
      element => {
        return coreApi.deleteNamespacedService(element, this.namespace);
      }
    );

    await this.deleteAll(
      await coreApi.listNamespacedConfigMap(this.namespace),
      element => {
        return coreApi.deleteNamespacedConfigMap(element, this.namespace);
      }
    );

    await this.deleteAll(
      await coreApi.listNamespacedSecret(this.namespace),
      element => {
        return coreApi.deleteNamespacedSecret(element, this.namespace);
      }
    );

    const customApi = this.kubeConfig.makeApiClient(CustomObjectsApi);
    await this.deleteAll(
      (await customApi.listNamespacedCustomObject(
        'logging.banzaicloud.io',
        'v1beta1',
        this.namespace,
        'flows'
      )) as {body: {items: {metadata?: V1ObjectMeta | undefined}[]}},
      element => {
        return customApi.deleteNamespacedCustomObject(
          'logging.banzaicloud.io',
          'v1beta1',
          this.namespace,
          'flows',
          element
        );
      }
    );

    await this.deleteAll(
      (await customApi.listNamespacedCustomObject(
        'logging.banzaicloud.io',
        'v1beta1',
        this.namespace,
        'outputs'
      )) as {body: {items: {metadata?: V1ObjectMeta | undefined}[]}},
      element => {
        return customApi.deleteNamespacedCustomObject(
          'logging.banzaicloud.io',
          'v1beta1',
          this.namespace,
          'outputs',
          element
        );
      }
    );
  };

  private deleteAll = (
    list: {
      body: {
        items: {metadata?: V1ObjectMeta}[];
      };
    },
    deleteFunction: (name: string) => Promise<{
      response: IncomingMessage;
    }>
  ) => {
    list.body.items.forEach(async element => {
      if (
        element.metadata &&
        element.metadata.labels &&
        element.metadata.labels['group'] === this.groupLabel &&
        element.metadata.name
      ) {
        console.log(`tear down ${element?.metadata?.name}`);
        await deleteFunction(element.metadata.name);
      } else {
        console.log(`leave ${element?.metadata?.name} alone..`);
      }
    });
  };

  public deployCustomObject = async (
    group: string,
    version: string,
    resourceTypeName: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    body: any
  ): Promise<void> => {
    body.metadata.namespace = this.namespace;
    body.metadata.labels['group'] = this.groupLabel;
    const customApi = this.kubeConfig.makeApiClient(CustomObjectsApi);
    await customApi.createNamespacedCustomObject(
      group,
      version,
      this.namespace,
      resourceTypeName,
      body
    );
  };
}
