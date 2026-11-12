import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AgentController } from './agent/agent.controller';
import { AgentOrchestratorService } from './agent/agent.orchestrator';
import { GuardrailsService } from './agent/guardrails.service';
import { ToolsService } from './tools/tools.service';
import { TraceCollectorService } from './observability/trace-collector.service';
import { OidcAuthGuard } from './auth/oidc-auth.guard';
import { DatabaseService } from './database/database.service';
import { HealthController } from './health/health.controller';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../.env', '.env'] })],
  controllers: [AgentController, HealthController],
  providers: [
    AgentOrchestratorService,
    GuardrailsService,
    ToolsService,
    TraceCollectorService,
    OidcAuthGuard,
    DatabaseService,
  ],
})
export class AppModule {}
