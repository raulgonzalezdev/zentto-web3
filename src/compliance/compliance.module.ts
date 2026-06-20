import { Module } from '@nestjs/common';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { AiReportService } from './ai-report.service';
import { ComplianceController } from './compliance.controller';
import { ComplianceService } from './compliance.service';
import { RiskScoringService } from './risk-scoring.service';

@Module({
  imports: [BlockchainModule],
  controllers: [ComplianceController],
  providers: [ComplianceService, RiskScoringService, AiReportService],
  exports: [ComplianceService],
})
export class ComplianceModule {}
