import {ContainerImage, Endpoint} from 'dssim-core';
import {BaseInstance} from '../BaseInstance.js';
import {KubernetesExecutor} from '../KubernetesExecutor.js';
import {V1ObjectMeta, V1PodSpec, V1Container, V1EnvVar} from '@kubernetes/client-node';

export class VaultInstance extends BaseInstance {
  static readonly Endpoints: Endpoint[] = [
    {name: 'api', path: '/', port: 8200},
  ];

  constructor(
    deploymentName: string = 'vault',
    private readonly rootToken: string = 'devpass',
    image: ContainerImage = {
      image: 'vault:latest',
      pullSecret: undefined,
    }
  ) {
    super(deploymentName, [image], VaultInstance.Endpoints);
  }

  public async deployApp(pullSecrets: {[key: string]: string}): Promise<void> {
    const env: V1EnvVar[] = [
      {name: 'VAULT_DEV_ROOT_TOKEN_ID', value: this.rootToken},
      {name: 'VAULT_ADDR', value: 'http://localhost:8200'},
    ];

    const container: V1Container = {
      name: this.deploymentName,
      image: this.containerImages[0].image,
      ports: this.endpoints.map(e => ({containerPort: e.port})),
      env: env,
      securityContext: {
        capabilities: {
          add: ['IPC_LOCK'],
        },
      },
      livenessProbe: {
        httpGet: {
          path: '/v1/sys/health',
          port: 8200,
          scheme: 'HTTP',
        },
        initialDelaySeconds: 30,
        periodSeconds: 10,
        timeoutSeconds: 5,
        failureThreshold: 5,
      },
    };

    await KubernetesExecutor.getInstance().deployApp(
      this.deploymentName,
      {
        selector: {matchLabels: {app: this.deploymentName}},
        replicas: 1,
        template: {
          metadata: {labels: {app: this.deploymentName}},
          spec: {
            containers: [container],
            imagePullSecrets: pullSecrets && Object.keys(pullSecrets).length > 0
              ? Object.entries(pullSecrets).map(([name, _]) => ({name}))
              : undefined,
          } as V1PodSpec,
        },
      },
      this.memoryLimit,
      this.cpuLimit
    );

    this.endPointUrl = `http://${this.deploymentName}:${
      this.endpoints.find(e => e.name === 'api')?.port
    }`;
    this.hostname = this.deploymentName;
    this.healthCheckUrl = `http://${this.deploymentName}:8200/v1/sys/health`;
  }

  public async deployConfigMaps(): Promise<void> {
    // No config maps needed for Vault
  }

  public async deploySecrets(): Promise<void> {
    // No additional secrets needed - token passed via env var
  }
}
