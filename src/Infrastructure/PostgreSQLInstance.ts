import {ContainerImage, Endpoint} from 'dssim-core';
import {BaseInstance} from '../BaseInstance.js';
import {KubernetesExecutor} from '../KubernetesExecutor.js';
import {V1PodSpec, V1Container, V1EnvVar} from '@kubernetes/client-node';

export class PostgreSQLInstance extends BaseInstance {
  static readonly Endpoints: Endpoint[] = [
    {name: 'database', path: '/', port: 5432},
  ];

  constructor(
    deploymentName: string = 'postgres',
    private readonly database: string = 'edc',
    private readonly username: string = 'edc',
    private readonly password: string = 'devpass',
    image: ContainerImage = {
      image: 'postgres:15',
      pullSecret: undefined,
    }
  ) {
    super(deploymentName, [image], PostgreSQLInstance.Endpoints);
  }

  public async deployApp(pullSecrets: {[key: string]: string}): Promise<void> {
    const env: V1EnvVar[] = [
      {name: 'POSTGRES_DB', value: this.database},
      {name: 'POSTGRES_USER', value: this.username},
      {name: 'POSTGRES_PASSWORD', value: this.password},
    ];

    const container: V1Container = {
      name: this.deploymentName,
      image: this.containerImages[0].image,
      ports: this.endpoints.map(e => ({containerPort: e.port})),
      env: env,
      livenessProbe: {
        exec: {
          command: [
            'pg_isready',
            '-U',
            this.username,
            '-d',
            this.database,
          ],
        },
        initialDelaySeconds: 10,
        periodSeconds: 10,
        timeoutSeconds: 5,
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

    this.endPointUrl = `${this.deploymentName}:${
      this.endpoints.find(e => e.name === 'database')?.port
    }`;
    this.hostname = this.deploymentName;
    this.healthCheckUrl = undefined;
  }

  public async deployConfigMaps(): Promise<void> {
    // No config maps needed for basic PostgreSQL
  }

  public async deploySecrets(): Promise<void> {
    // Secrets handled via environment variables
  }
}
